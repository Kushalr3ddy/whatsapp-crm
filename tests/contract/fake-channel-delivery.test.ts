import { describe, expect, it } from 'vitest';
import { FakeChannelProvider } from '@crm/channel-fake';
import type { SenderRef, NormalisedStatusEvent } from '@crm/channels';

/**
 * `autoDeliverAfterMs`: the fake gateway reports a delivery receipt for every accepted send, so a
 * healthy fake number shows delivered like a real one. Off by default,
 * so tests that drive receipts by hand are unaffected.
 */
const sender: SenderRef = { id: 'sender-1', phoneE164: '+12025550100' };
const to = { phoneE164: '+12025550101', providerAddress: '12025550101@s.whatsapp.net' };

/** Reads status events until `count` have arrived or the time budget runs out. */
async function collect(p: FakeChannelProvider, count: number, ms: number): Promise<NormalisedStatusEvent[]> {
  const seen: NormalisedStatusEvent[] = [];
  const stop = Date.now() + ms;
  const it = p.status()[Symbol.asyncIterator]();
  while (seen.length < count && Date.now() < stop) {
    const next = await Promise.race([
      it.next(), new Promise<null>((r) => setTimeout(() => { r(null); }, Math.max(1, stop - Date.now())))
    ]);
    if (next === null || next.done === true) break;
    seen.push(next.value);
  }
  return seen;
}

describe('fake channel auto-delivery', () => {
  it('reports sent, then delivered, when enabled', async () => {
    const p = new FakeChannelProvider({ autoDeliverAfterMs: 20 });
    await p.connect(sender);
    const r = await p.send(sender, to, { kind: 'text', body: 'hi' } as never);
    const events = await collect(p, 3, 1_000);
    const mine = events.filter((e) => e.providerMessageId === r.providerMessageId).map((e) => e.status);
    expect(mine).toEqual(['sent', 'delivered']);
    await p.shutdown();
  });

  it('stays silent after "sent" when not enabled', async () => {
    const p = new FakeChannelProvider();
    await p.connect(sender);
    await p.send(sender, to, { kind: 'text', body: 'hi' } as never);
    const events = await collect(p, 2, 150);
    expect(events.map((e) => e.status)).toEqual(['sent']);
    await p.shutdown();
  });
});
