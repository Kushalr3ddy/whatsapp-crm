import { describe, expect, it } from 'vitest';
import {
  isBlankMarker, isMatchableIdentity, normalisePhone, normalisePhoneCell, splitPhoneCell
} from './phone.js';

describe('normalisePhone', () => {
  it('normalises the same Indian number written five ways to one E.164 value', () => {
    // The M8 regression test: these were five different contacts in the old system.
    const forms = ['+91 98765 43210', '9876543210', '919876543210', '+919876543210', '098765 43210'];
    const results = forms.map((f) => normalisePhone(f, 'IN'));
    for (const r of results) expect(r.ok, JSON.stringify(r)).toBe(true);
    const values = new Set(results.map((r) => (r.ok ? r.value.e164 : 'FAILED')));
    expect(values).toEqual(new Set(['+919876543210']));
  });

  it('strips brackets, dots and non-breaking spaces that spreadsheets introduce', () => {
    const r = normalisePhone('(+91) 98765.43210', 'IN');
    expect(r.ok && r.value.e164).toBe('+919876543210');
  });

  it('rejects empty input rather than returning an empty string', () => {
    // M7: an empty value that compares equal to another empty value is how the old
    // dedup merged unrelated people. Blank must never be matchable.
    for (const blank of ['', '   ', null, undefined]) {
      const r = normalisePhone(blank, 'IN');
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.reason).toBe('empty');
    }
  });

  it('reports a reason instead of silently storing a value with no digits', () => {
    const r = normalisePhone('not a number', 'IN');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('no_digits');
  });

  it('rejects a number that is too short to be real', () => {
    const r = normalisePhone('12345', 'IN');
    expect(r.ok === false && r.reason).toBe('too_short');
  });

  it('respects an explicit country code over the default country', () => {
    const r = normalisePhone('+44 20 7946 0958', 'IN');
    expect(r.ok && r.value.e164).toBe('+442079460958');
  });

  it('rejects junk that the default metadata bundle would wave through', () => {
    // The stdlib metadata accepts both of these as valid Indian numbers; the `max`
    // bundle does not. Spreadsheet imports are full of exactly this.
    for (const junk of ['1111111111', '5555555555']) {
      const r = normalisePhone(junk, 'IN');
      expect(r.ok, `${junk} should be rejected`).toBe(false);
      expect(r.ok === false && r.reason).toBe('invalid_for_country');
    }
  });

  it('identifies a landline as unreachable on WhatsApp', () => {
    // Worth catching at import: a send to a landline fails, and the failure costs the
    // sender's delivery ratio, which feeds its health score.
    const mobile = normalisePhone('9876543210', 'IN');
    expect(mobile.ok && mobile.value.type).toBe('mobile');
    expect(mobile.ok && mobile.value.reachableOnWhatsApp).toBe(true);

    const landline = normalisePhone('+91 11 2345 6789', 'IN');
    expect(landline.ok && landline.value.type).toBe('fixed_line');
    expect(landline.ok && landline.value.reachableOnWhatsApp).toBe(false);
  });
});

describe('isMatchableIdentity', () => {
  it('treats blank and whitespace-only values as unmatchable', () => {
    expect(isMatchableIdentity('')).toBe(false);
    expect(isMatchableIdentity('   ')).toBe(false);
    expect(isMatchableIdentity(null)).toBe(false);
    expect(isMatchableIdentity(undefined)).toBe(false);
    expect(isMatchableIdentity('+919876543210')).toBe(true);
  });
});

// Fiction-range numbers (+1 202 555 01xx) only: they can never belong to a real person.
describe('splitPhoneCell', () => {
  it('splits on comma, semicolon, slash, pipe and line breaks, and nothing else', () => {
    expect(splitPhoneCell('2025550101, +12025550102')).toEqual(['2025550101', '+12025550102']);
    expect(splitPhoneCell('2025550101;2025550102/2025550103|2025550104\n2025550105'))
      .toHaveLength(5);
    // Spaces and dashes belong inside one number.
    expect(splitPhoneCell('+1 202-555-0101')).toEqual(['+1 202-555-0101']);
  });
});

describe('normalisePhoneCell', () => {
  it('reads a Naukri-style cell: a bare number, a comma, then a second number', () => {
    const r = normalisePhoneCell('2025550101, +12025550102', 'US');
    expect(r.numbers.map((n) => n.e164)).toEqual(['+12025550101', '+12025550102']);
    expect(r.firstFailure).toBeNull();
  });

  it('keeps a number written twice only once', () => {
    const r = normalisePhoneCell('2025550101, +12025550101', 'US');
    expect(r.numbers.map((n) => n.e164)).toEqual(['+12025550101']);
  });

  it('ignores a lone country code, which is what an empty second number looks like', () => {
    const r = normalisePhoneCell('2025550101, +1', 'US');
    expect(r.numbers.map((n) => n.e164)).toEqual(['+12025550101']);
    expect(r.firstFailure).toBeNull();
  });

  it('does not lose a good number to a bad neighbour', () => {
    const r = normalisePhoneCell('1111111111, 2025550103', 'US');
    expect(r.numbers.map((n) => n.e164)).toEqual(['+12025550103']);
  });

  it('reports the failure when no part is usable', () => {
    const r = normalisePhoneCell('1111111111', 'US');
    expect(r.numbers).toHaveLength(0);
    expect(r.firstFailure?.reason).toBe('invalid_for_country');
  });

  it('still fails text and too-short numbers, which are mistakes rather than empty', () => {
    expect(normalisePhoneCell('not-a-phone', 'US').firstFailure?.reason).toBe('no_digits');
    expect(normalisePhoneCell('12345', 'US').firstFailure?.reason).toBe('too_short');
  });

  it('treats a cell that is only a country code as empty, not as an error', () => {
    const r = normalisePhoneCell('+1', 'US');
    expect(r.numbers).toHaveLength(0);
    expect(r.firstFailure).toBeNull();
  });
});

describe('isBlankMarker', () => {
  it('recognises the markers sheets use for "nothing here", whole cell only', () => {
    for (const blank of ['NA', 'na', ' N/A ', 'null', 'None', '-', '--']) {
      expect(isBlankMarker(blank), blank).toBe(true);
    }
    for (const real of ['Nair', 'Kana', 'Anita', 'N A', '']) {
      expect(isBlankMarker(real), real).toBe(false);
    }
  });
});
