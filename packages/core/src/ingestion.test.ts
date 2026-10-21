import { describe, expect, it } from 'vitest';
import { joinName } from './ingestion.js';

describe('joinName', () => {
  it('joins a first and last name as written, never shortening them', () => {
    expect(joinName('Anita', 'Sharma')).toBe('Anita Sharma');
    expect(joinName(' Kiran ', 'Rao ')).toBe('Kiran Rao');
    expect(joinName('ANITA', 'sharma')).toBe('ANITA sharma');
  });

  it('joins with a dot only when the first name is already a single letter', () => {
    expect(joinName('a', 'sharma')).toBe('a.sharma');
    expect(joinName('R', 'Iyer')).toBe('R.Iyer');
    expect(joinName('R.', 'Iyer')).toBe('R.Iyer');
  });

  it('uses whichever part is filled in, and treats blank markers as empty', () => {
    expect(joinName('Anita', '')).toBe('Anita');
    expect(joinName('', 'Sharma')).toBe('Sharma');
    expect(joinName('NA', 'Sharma')).toBe('Sharma');
    expect(joinName('', '')).toBe('');
  });
});
