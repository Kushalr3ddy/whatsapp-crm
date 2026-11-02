import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvRows, CsvError } from './csv.js';
import { IMPORT_LIMITS, ImportLimitError } from './import-limits.js';

/**
 * The CSV grammar is small and completely specified, which is the only reason writing the
 * parser was preferable to taking a dependency. That trade only holds if the edges are tested
 * deliberately — so these are the cases naive splitting gets wrong, plus the ones real
 * spreadsheet exports actually produce.
 */
describe('the things naive splitting gets wrong', () => {
  it('keeps a comma inside quotes', () => {
    expect(parseCsvRows('a,"b,c",d')).toEqual([['a', 'b,c', 'd']]);
  });

  it('keeps a newline inside quotes, and does not start a new row', () => {
    const rows = parseCsvRows('name,note\n"Priya","line one\nline two"\n');
    expect(rows).toEqual([['name', 'note'], ['Priya', 'line one\nline two']]);
  });

  it('reads a doubled quote as one literal quote', () => {
    expect(parseCsvRows('a,"she said ""hi""",b')).toEqual([['a', 'she said "hi"', 'b']]);
  });

  it('handles CRLF exactly like LF', () => {
    expect(parseCsvRows('a,b\r\nc,d\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('strips the byte-order mark Excel writes', () => {
    // Without this the first header becomes "<BOM>Name" and the mapping silently matches
    // nothing — which looks like an empty import rather than an error.
    const table = parseCsv('﻿Name,Mobile\nPriya,+919876543210\n');
    expect(table.headers).toEqual(['Name', 'Mobile']);
    expect(table.rows[0]!.Name).toBe('Priya');
  });
});

describe('what real exports look like', () => {
  it('treats a short row as empty trailing cells rather than an error', () => {
    // Spreadsheets routinely omit trailing empty cells. Refusing the file would reject data
    // that is perfectly usable.
    const table = parseCsv('a,b,c\n1,2\n');
    expect(table.rows[0]).toEqual({ a: '1', b: '2', c: '' });
  });

  it('keeps fields beyond the header rather than dropping them', () => {
    const table = parseCsv('a,b\n1,2,3\n');
    expect(table.rows[0]!['column 3']).toBe('3');
  });

  it('disambiguates duplicate column names instead of losing one', () => {
    const table = parseCsv('Email,Email\na@x.com,b@x.com\n');
    expect(table.headers).toEqual(['Email', 'Email (2)']);
    expect(table.rows[0]).toEqual({ Email: 'a@x.com', 'Email (2)': 'b@x.com' });
  });

  it('skips blank lines without producing empty records', () => {
    const table = parseCsv('a\n1\n\n2\n');
    expect(table.rows.map((r) => r.a)).toEqual(['1', '2']);
  });

  it('reads a final row with no trailing newline', () => {
    const table = parseCsv('a,b\n1,2');
    expect(table.rows).toHaveLength(1);
  });

  it('preserves a value that only looks like a number', () => {
    // A phone number with a leading zero, or an id with one, must survive as text. Anything
    // that coerced here would corrupt the data before the mapping ever saw it.
    const table = parseCsv('id,mobile\n007,0981234567\n');
    expect(table.rows[0]).toEqual({ id: '007', mobile: '0981234567' });
  });
});

describe('what it refuses', () => {
  it('refuses a file that ends inside a quoted field', () => {
    // Truncated upload or a corrupted export. Guessing where the field ended would invent data.
    expect(() => parseCsvRows('a,"unterminated')).toThrow(CsvError);
  });

  it('refuses a quote appearing mid-field', () => {
    // The two plausible repairs disagree about the value, so picking one silently corrupts it.
    expect(() => parseCsvRows('a,bad"quote,c')).toThrow(/unexpected quote/);
  });

  it('names the line it failed on', () => {
    try {
      parseCsvRows('a,b\nc,d\ne,"oops');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as CsvError).line).toBe(3);
    }
  });

  it('refuses a header row with no names at all', () => {
    expect(() => parseCsv(',,\n1,2,3\n')).toThrow(/header row is empty/);
  });

  it('returns nothing for an empty file rather than throwing', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
  });
});

describe('scale', () => {
  it('reads fifty thousand rows', () => {
    // P5's exit criterion is 50k hostile rows with a per-row report and no data loss. This is
    // only the reading half, but it is the half that has to not fall over first.
    const lines = ['name,mobile'];
    for (let i = 0; i < 50_000; i++) lines.push(`Person ${String(i)},+9198765${String(i).padStart(5, '0')}`);
    const table = parseCsv(lines.join('\n'));

    expect(table.rows).toHaveLength(50_000);
    expect(table.rows[49_999]!.name).toBe('Person 49999');
  });
});

describe('[R-016] the import limits, checked during the one scan', () => {
  const small = { ...IMPORT_LIMITS, maxColumns: 3, maxRows: 2, maxCellChars: 5, maxCells: 7 };
  const kindOf = (text: string): string | undefined => {
    try { parseCsvRows(text, small); return undefined; } catch (error) { return error instanceof ImportLimitError ? error.kind : 'other'; }
  };

  it('[R-016] stops at the first column, row, long cell or cell over the limit', () => {
    expect(kindOf('a,b,c,d\n')).toBe('columns');
    expect(kindOf('h\n1\n2\n3\n')).toBe('rows');             // the header does not count, the third data row does
    expect(kindOf('abcdef\n')).toBe('cell');
    expect(kindOf('a,b,c\nd,e,f\ng,h,i\n')).toBe('cells');    // nine cells over a limit of seven, within the row limit
  });

  it('[R-016] lets a file inside every limit through unchanged', () => {
    expect(kindOf('a,b\nc,d\ne,f\n')).toBeUndefined();
    expect(parseCsv('Name\nAsha\n', small).rows).toEqual([{ Name: 'Asha' }]);
  });
});
