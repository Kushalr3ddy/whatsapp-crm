import { describe, expect, it } from 'vitest';
import { loadAuthState } from './auth-adapter.js';

/** A store whose first write to a key is slower than the second, the way two overlapping database writes can land out of order. */
function slowFirstStore() {
  const data = new Map<string, string>();
  const order: string[] = [];
  let calls = 0;
  return {
    data, order,
    get: (_s: string, key: string) => Promise.resolve(data.has(key) ? new TextEncoder().encode(data.get(key)!) : null),
    set: async (_s: string, key: string, value: Uint8Array) => {
      const n = ++calls;
      await new Promise((r) => setTimeout(r, n === 1 ? 40 : 1));
      data.set(key, new TextDecoder().decode(value));
      order.push(`${key}#${String(n)}`);
    },
    remove: (_s: string, key: string) => { data.delete(key); return Promise.resolve(); },
    clear: () => Promise.resolve(),
    keys: () => Promise.resolve([...data.keys()])
  };
}

describe('the credential store writer', () => {
  it('writes to one key in the order asked, so an older session state never replaces a newer one (D-82)', async () => {
    const store = slowFirstStore();
    const { state, flush } = await loadAuthState(store as never, 'sender-1');
    const first = state.keys.set({ session: { 'a.0': { v: 1 } as never } });
    const second = state.keys.set({ session: { 'a.0': { v: 2 } as never } });
    await Promise.all([first, second]);
    await flush();
    expect(store.order).toEqual(['session-a.0#1', 'session-a.0#2']);
    expect(JSON.parse(store.data.get('session-a.0')!)).toEqual({ v: 2 });
  });

  it('lets writes to different keys run side by side', async () => {
    const store = slowFirstStore();
    const { state, flush } = await loadAuthState(store as never, 'sender-1');
    await state.keys.set({ session: { 'a.0': { v: 1 } as never, 'b.0': { v: 1 } as never } });
    await flush();
    // The second key finished before the slow first one: they were not forced into a line.
    expect(store.order[0]).toBe('session-b.0#2');
  });

  it('flush waits for every write asked for so far', async () => {
    const store = slowFirstStore();
    const { state, flush } = await loadAuthState(store as never, 'sender-1');
    void state.keys.set({ session: { 'a.0': { v: 9 } as never } });
    expect(store.data.has('session-a.0')).toBe(false);
    await flush();
    expect(store.data.has('session-a.0')).toBe(true);
  });

  it('removes a key (a null value) without keeping a dead one', async () => {
    const store = slowFirstStore();
    const { state, flush } = await loadAuthState(store as never, 'sender-1');
    await state.keys.set({ 'pre-key': { '5': { private: new Uint8Array(1), public: new Uint8Array(1) } } as never });
    await state.keys.set({ 'pre-key': { '5': null } as never });
    await flush();
    expect(store.data.has('pre-key-5')).toBe(false);
  });
});
