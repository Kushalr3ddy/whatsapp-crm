import { describe, expect, it } from 'vitest';
import { isDecryptWave } from './decrypt.js';

const T = new Date('2026-11-02T10:00:00.000Z');
const ago = (min: number) => new Date(T.getTime() - min * 60_000);

describe('AC-5.4 a wave of retries', () => {
  it('AC-5.4 retries from 3 different contacts within 10 minutes is a wave', () => {
    expect(isDecryptWave([{ contact: 'a', at: ago(9) }, { contact: 'b', at: ago(5) }, { contact: 'c', at: ago(0) }], T)).toBe(true);
  });

  it('AC-5.4 two contacts is not a wave, however many retries they sent', () => {
    expect(isDecryptWave([{ contact: 'a', at: ago(1) }, { contact: 'b', at: ago(2) }, { contact: 'a', at: ago(3) }, { contact: 'b', at: ago(4) }], T)).toBe(false);
  });

  it('AC-5.4 one contact asking again and again is not a wave', () => {
    expect(isDecryptWave([1, 2, 3, 4].map((m) => ({ contact: 'a', at: ago(m) })), T)).toBe(false);
  });

  it('AC-5.4 retries spread over more than 10 minutes are not a wave', () => {
    expect(isDecryptWave([{ contact: 'a', at: ago(11) }, { contact: 'b', at: ago(5) }, { contact: 'c', at: ago(0) }], T)).toBe(false);
  });
});
