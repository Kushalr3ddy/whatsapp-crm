import { describe, expect, it } from 'vitest';
import { profileColumns, suggestColumns } from './column-guess.js';

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
