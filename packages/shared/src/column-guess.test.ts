import { describe, expect, it } from 'vitest';
import { blankCounts, matchRows, pickRows, rowsCsv, profileColumns, suggestColumns } from './column-guess.js';

// Fiction-range numbers only (+1 202 555 01xx): they can never belong to a real person.
const rows = (n: number, make: (i: number) => Record<string, string>) =>
  Array.from({ length: n }, (_, i) => make(i));
const phone = (i: number): string => `20255501${String(i % 100).padStart(2, '0')}`;

describe('suggestColumns', () => {
  it('finds the phone column by its values when the header says nothing', () => {
    const headers = ['Col A', 'Col B', 'Col C'];
    const data = rows(30, (i) => ({ 'Col A': `Person ${String(i)}`, 'Col B': phone(i), 'Col C': `p${String(i)}@example.test` }));
    const s = suggestColumns(profileColumns(headers, data, 'US'));
    expect(s.phone).toBe('Col B');
    expect(s.email).toBe('Col C');
  });

  it('is not fooled by a header that says "contact" when the values are names', () => {
    const headers = ['Contact Person', 'Mob'];
    const data = rows(30, (i) => ({ 'Contact Person': `Asha Rao ${String(i)}`, Mob: phone(i) }));
    expect(suggestColumns(profileColumns(headers, data, 'US')).phone).toBe('Mob');
  });

  it('reads a column of two-number cells as phones', () => {
    const data = rows(30, (i) => ({ Phone: `${phone(i)}, +1${phone(i + 1)}`, Name: `N${String(i)}` }));
    expect(suggestColumns(profileColumns(['Name', 'Phone'], data, 'US')).phone).toBe('Phone');
  });

  it('ignores NA and blank cells when judging a column', () => {
    const data = rows(40, (i) => ({ Mobile: i % 2 === 0 ? 'NA' : phone(i), Name: `N${String(i)}` }));
    const p = profileColumns(['Name', 'Mobile'], data, 'US');
    expect(p[1]!.sampled).toBe(20);
    expect(p[1]!.phoneShare).toBe(1);
    expect(suggestColumns(p).phone).toBe('Mobile');
  });

  it('prefers the main phone column over a mostly empty alternate one', () => {
    const data = rows(30, (i) => ({ Mob: phone(i), Alt: i === 0 ? phone(50) : 'NA' }));
    expect(suggestColumns(profileColumns(['Alt', 'Mob'], data, 'US')).phone).toBe('Mob');
  });

  it('suggests nothing when no column looks like phones, rather than guessing', () => {
    const data = rows(30, (i) => ({ Name: `Person ${String(i)}`, City: 'Pune' }));
    expect(suggestColumns(profileColumns(['Name', 'City'], data, 'US')).phone).toBeNull();
  });

  it('measures how phone-like a column is, so a poor choice can be flagged', () => {
    const data = rows(10, (i) => ({ Notes: i < 3 ? phone(i) : 'called, no answer' }));
    expect(profileColumns(['Notes'], data, 'US')[0]!.phoneShare).toBeCloseTo(0.3);
  });

  it('keeps the name column away from the phone and email columns', () => {
    const data = rows(30, (i) => ({ 'Candidate Name': `Asha ${String(i)}`, 'Phone Number': phone(i), 'Email ID': `a${String(i)}@example.test` }));
    expect(suggestColumns(profileColumns(['Candidate Name', 'Phone Number', 'Email ID'], data, 'US')))
      .toEqual({ phone: 'Phone Number', email: 'Email ID', name: 'Candidate Name' });
  });
});

describe('blankCounts', () => {
  it('counts blanks and "no value" markers per column', () => {
    const data = [
      { Name: 'Asha', Email: '', City: 'NA' },
      { Name: 'Bilal', Email: 'b@example.test', City: '-' },
      { Name: '  ', Email: 'c@example.test', City: 'Pune' }
    ];
    expect(blankCounts(['Name', 'Email', 'City'], data)).toEqual([
      { header: 'Name', blank: 1 }, { header: 'Email', blank: 1 }, { header: 'City', blank: 2 }
    ]);
  });
  it('counts a column the row does not have at all as blank', () => {
    expect(blankCounts(['Name', 'Extra'], [{ Name: 'Asha' }])).toEqual([{ header: 'Name', blank: 0 }, { header: 'Extra', blank: 1 }]);
  });
});

describe('pickRows', () => {
  it('picks different positions in file order', () => {
    const picked = pickRows(160, 3);
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
    expect(picked).toEqual([...picked].sort((a, b) => a - b));
    expect(picked.every((p) => p >= 0 && p < 160)).toBe(true);
  });
  it('takes everyone from a file smaller than the draw', () => {
    expect(pickRows(2, 3)).toEqual([0, 1]);
    expect(pickRows(0, 3)).toEqual([]);
  });
  it('never leaves the range even when the draw is at its top', () => {
    expect(pickRows(5, 5, () => 0.9999999)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('matchRows', () => {
  const headers = ['Name', 'Phone', 'City', 'Notes'];
  const data = [
    { Name: 'Asha', Phone: '2025550101', City: 'Pune', Notes: 'likes tea' },
    { Name: '', Phone: '2025550102', City: 'NA', Notes: '' },
    { Name: 'Ravi', Phone: '2025550103', City: '', Notes: 'Call after 5' },
    { Name: '', Phone: '2025550104', City: 'Surat', Notes: '-' }
  ];

  it('gives every row, in file order, when there is no filter', () => {
    expect(matchRows(headers, data, {})).toEqual([0, 1, 2, 3]);
  });

  it('with several details chosen, "any" keeps the people missing at least one of them', () => {
    expect(matchRows(headers, data, { missing: ['Name', 'City'] })).toEqual([1, 2, 3]);
  });

  it('with several details chosen, "all" keeps only the people missing every one of them', () => {
    expect(matchRows(headers, data, { missing: ['Name', 'City'], mode: 'all' })).toEqual([1]);
  });

  it('counts "NA" and a lone dash as blank, like the missing-details counts do', () => {
    expect(matchRows(headers, data, { missing: ['Notes'] }).length).toBe(blankCounts(headers, data).find((c) => c.header === 'Notes')?.blank);
  });

  it('searches every column, ignoring case, and combines with the missing filter', () => {
    expect(matchRows(headers, data, { q: 'CALL' })).toEqual([2]);
    expect(matchRows(headers, data, { q: '0102' })).toEqual([1]);
    expect(matchRows(headers, data, { q: 'pune', missing: ['Name'] })).toEqual([]);
  });

  it('ignores a detail the sheet does not have instead of matching nobody or everybody', () => {
    expect(matchRows(headers, data, { missing: ['Nope'] })).toEqual([0, 1, 2, 3]);
    expect(matchRows(headers, data, { missing: ['Nope', 'Name'] })).toEqual([1, 3]);
  });
});

describe('rowsCsv', () => {
  const headers = ['Name', 'Phone', 'City'];
  const data = [
    { Name: 'Asha', Phone: '1', City: 'Pune' },
    { Name: '', Phone: '2', City: 'say "hi", ok' }
  ];

  it('writes the chosen rows with the sheet’s own columns in the sheet’s order and nothing added', () => {
    expect(rowsCsv(headers, data, [1])).toEqual({ count: 1, csv: '"Name","Phone","City"\n"","2","say ""hi"", ok"' });
  });

  it('gives only the header line for no rows', () => {
    expect(rowsCsv(headers, data, [])).toEqual({ count: 0, csv: '"Name","Phone","City"' });
  });
});
