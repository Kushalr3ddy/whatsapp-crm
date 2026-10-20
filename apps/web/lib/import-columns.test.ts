import { describe, expect, it } from 'vitest';
import { isPersonalColumn } from './personal-columns';
import { joinNamePreview } from './join-name';

describe('isPersonalColumn', () => {
  it('flags the columns a recruiter should not copy by default', () => {
    for (const h of ['Date of birth', 'DOB', 'Annual Salary', 'Current CTC', 'Home Address', 'Aadhaar No', 'PAN', 'Marital Status', 'Gender']) {
      expect(isPersonalColumn(h)).toBe(true);
    }
  });

  it('leaves ordinary columns alone', () => {
    for (const h of ['Current Location', 'Total Experience', 'Key Skills', 'Notice period', 'Phone Number', 'Email ID']) {
      expect(isPersonalColumn(h)).toBe(false);
    }
  });
});

describe('joinNamePreview', () => {
  it('matches the server rules for joining names', () => {
    expect(joinNamePreview('Anita', 'Sharma')).toBe('Anita Sharma');
    expect(joinNamePreview('a', 'sharma')).toBe('a.sharma');
    expect(joinNamePreview('R.', 'Iyer')).toBe('R.Iyer');
    expect(joinNamePreview('Anita', '')).toBe('Anita');
    expect(joinNamePreview('NA', 'Sharma')).toBe('Sharma');
  });
});
