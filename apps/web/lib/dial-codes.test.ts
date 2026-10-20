import { describe, expect, it } from 'vitest';
import { composeE164, dialCodes, guessCountry, readTyped } from './dial-codes';

const known = dialCodes('en');

describe('dial codes', () => {
  it('lists countries by name with their dialling codes', () => {
    const india = known.find((d) => d.code === 'IN');
    expect(india?.dial).toBe('91');
    expect(known.length).toBeGreaterThan(200);
  });

  it('guesses the country from the browser language and falls back to India', () => {
    expect(guessCountry(['en-PH'], known)).toBe('PH');
    expect(guessCountry(['en'], known)).toBe('IN');
    expect(guessCountry([], known)).toBe('IN');
  });

  it('keeps only digits and leaves the country alone when there is no plus', () => {
    expect(readTyped('98-76 abc 5', known, 'IN')).toEqual({ country: 'IN', national: '98765' });
  });

  it('switches the country when the number starts with a plus code', () => {
    expect(readTyped('+91 99641 22631', known, 'PH')).toEqual({ country: 'IN', national: '9964122631' });
    expect(readTyped('+63 917 123 4567', known, 'IN')).toEqual({ country: 'PH', national: '9171234567' });
    // +1 is shared by many countries: stay on the current one if it has the code, else pick the usual one.
    expect(readTyped('+1 202 555 0100', known, 'CA').country).toBe('CA');
    expect(readTyped('+1 202 555 0100', known, 'IN').country).toBe('US');
  });

  it('composes the number the API expects, with no leading zero', () => {
    expect(composeE164('IN', '9964122631')).toBe('+919964122631');
    expect(composeE164('GB', '07911 123456')).toBe('+447911123456');
    expect(composeE164('IN', '')).toBe('');
  });
});
