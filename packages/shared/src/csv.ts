/**
 * A strict RFC 4180 CSV reader.
 *
 * Hand-written rather than a dependency, because the grammar is small and completely specified
 * and the alternative is auditing a transitive tree for something this project parses hostile
 * files with. The cost is that every edge has to be tested deliberately — quoted fields
 * containing commas, quotes and newlines; CRLF; a byte-order mark; ragged rows — which is what
 * `csv.test.ts` does.
 *
 * Deliberately **not** a streaming parser yet. A streaming reader is what the `SourceConnector`
 * port calls for so a 2 GB file is never buffered (docs/07-ingestion.md), and this will move
 * behind that port when the file sizes justify it. Until then the upload limit bounds the bytes and
 * `ImportLimits` bounds the shape (R-016): a 20 MB line of commas is two million columns, so columns,
 * rows, cell length and total cells are counted during the one scan, which stops at the first one over.
 */
import {
  IMPORT_LIMITS, cellTooLong, tooManyCells, tooManyColumns, tooManyRows, type ImportLimits
} from './import-limits.js';

/** One parsed file: the header row, and every data row aligned to it. */
export interface CsvTable {
  readonly headers: readonly string[];
  /** Each row as a field-name → value record. Missing trailing fields become ''. */
  readonly rows: readonly Readonly<Record<string, string>>[];
}

/** Thrown when the text cannot be read as CSV at all. Never used for a merely odd row. */
export class CsvError extends Error {
  /** Carries the line, because "malformed CSV" without a location is an unhelpful message. */
  constructor(message: string, readonly line: number) {
    super(`${message} (line ${String(line)})`);
    this.name = 'CsvError';
  }
}

/**
 * Splits CSV text into rows of fields.
 *
 * Handles the three things naive splitting gets wrong: a comma inside quotes, a newline inside
 * quotes, and a literal quote written as two quotes. Everything else is a plain character.
 */
export function parseCsvRows(text: string, limits: ImportLimits = IMPORT_LIMITS): string[][] {
  // A byte-order mark on the first field turns "Name" into "<BOM>Name", and the mapping then
  // silently matches nothing. Excel writes one by default, so this is the common case.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let sawAny = false;
  let cells = 0;

  /** Ends the current field, refusing it (or the row it widens) when it crosses a limit. */
  const endField = (): void => {
    if (field.length > limits.maxCellChars) throw cellTooLong(limits);
    row.push(field);
    if (row.length > limits.maxColumns) throw tooManyColumns(limits);
    field = '';
  };
  /** Ends the current row; the header row is not counted against the row limit. */
  const endRow = (): void => {
    rows.push(row);
    if (rows.length > limits.maxRows + 1) throw tooManyRows(limits);
    cells += row.length;
    if (cells > limits.maxCells) throw tooManyCells(limits);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;

    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }   // an escaped quote
        else quoted = false;                                // closing quote
      } else {
        if (c === '\n') line++;
        field += c;
      }
      continue;
    }

    if (c === '"') {
      if (field !== '') {
        // A quote in the middle of an unquoted field. Refusing beats guessing: the two
        // plausible repairs disagree about the value, and silently picking one corrupts data.
        throw new CsvError('unexpected quote in the middle of an unquoted field', line);
      }
      quoted = true;
      sawAny = true;
      continue;
    }
    if (c === ',') { endField(); sawAny = true; continue; }
    if (c === '\r') continue;                                // CRLF, handled on the \n
    if (c === '\n') {
      endField();
      endRow();
      line++; sawAny = false;
      continue;
    }
    field += c;
    sawAny = true;
  }

  if (quoted) throw new CsvError('file ends inside a quoted field', line);
  // A trailing newline leaves nothing pending; anything else is a final row without one.
  if (field !== '' || row.length > 0 || sawAny) { endField(); endRow(); }

  return rows;
}

/**
 * Parses CSV into rows keyed by header name.
 *
 * **A ragged row is not an error.** Files exported from spreadsheets routinely omit trailing
 * empty cells, and refusing the file would reject data that is perfectly usable — missing
 * fields become empty strings, and extra fields beyond the header are kept under a positional
 * name so `unmapped: keep` can preserve them for inspection.
 */
export function parseCsv(text: string, limits: ImportLimits = IMPORT_LIMITS): CsvTable {
  const raw = parseCsvRows(text, limits);
  if (raw.length === 0) return { headers: [], rows: [] };

  const headers = raw[0]!.map((h) => h.trim());
  if (headers.every((h) => h === '')) throw new CsvError('the header row is empty', 1);

  const seen = new Map<string, number>();
  const unique = headers.map((h) => {
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    // Duplicate column names are common in exports and silently dropping one loses data.
    return n === 1 ? h : `${h} (${String(n)})`;
  });

  const rows = raw.slice(1)
    // A row of nothing but empty fields is a blank line, not a record with no values.
    .filter((cells) => !(cells.length === 1 && cells[0] === ''))
    .map((cells) => {
      const record: Record<string, string> = {};
      for (let i = 0; i < unique.length; i++) record[unique[i]!] = cells[i] ?? '';
      for (let i = unique.length; i < cells.length; i++) record[`column ${String(i + 1)}`] = cells[i]!;
      return record;
    });

  return { headers: unique, rows };
}
