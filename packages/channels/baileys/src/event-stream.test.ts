import { describe, expect, it } from 'vitest';
import { EventStream } from './event-stream.js';

/** Reads `count` events, giving up after a timeout so a hang fails loudly instead of stalling. */
async function take<T>(stream: EventStream<T>, count: number, ms = 1000): Promise<T[]> {
  const out: T[] = [];
  const timer = new Promise<never>((_, rej) => setTimeout(() => { rej(new Error('timed out')); }, ms));
  await Promise.race([
    (async () => { for await (const e of stream) { out.push(e); if (out.length === count) return; } })(),
    timer
  ]);
  return out;
}

describe('EventStream', () => {
  it('delivers events pushed before anyone is reading', async () => {
    // The M29 case: events arriving during startup must not be lost.
    const s = new EventStream<string>();
    s.push('a'); s.push('b');
    expect(await take(s, 2)).toEqual(['a', 'b']);
  });

  it('delivers events pushed while a reader is waiting', async () => {
    const s = new EventStream<string>();
    const reading = take(s, 2);
    setTimeout(() => { s.push('x'); s.push('y'); }, 10);
    expect(await reading).toEqual(['x', 'y']);
  });

  it('preserves order when buffered and live events mix', async () => {
    const s = new EventStream<number>();
    s.push(1); s.push(2);
    const reading = take(s, 4);
    setTimeout(() => { s.push(3); s.push(4); }, 10);
    expect(await reading).toEqual([1, 2, 3, 4]);
  });

  it('ends the loop on close instead of hanging forever', async () => {
    const s = new EventStream<string>();
    s.push('only');
    const got: string[] = [];
    const loop = (async () => { for await (const e of s) got.push(e); })();
    setTimeout(() => { s.close(); }, 10);
    await loop;
    expect(got).toEqual(['only']);
  });

  it('ignores pushes after close rather than throwing', async () => {
    const s = new EventStream<string>();
    s.close();
    expect(() => { s.push('late'); }).not.toThrow();
    expect(s.pending).toBe(0);
  });

  it('reports how far behind a consumer is', () => {
    const s = new EventStream<number>();
    s.push(1); s.push(2); s.push(3);
    expect(s.pending).toBe(3);
  });
});
