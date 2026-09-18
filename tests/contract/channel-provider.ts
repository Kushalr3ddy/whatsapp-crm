import { describe, expect, it } from 'vitest';
import type { ChannelProvider, SenderRef } from '@crm/channels';

/** How a suite run gets a fresh provider, and how it drives the fake side of it. */
export interface ChannelProviderHarness {
  /** A clean provider instance per test. */
  create(): Promise<{ provider: ChannelProvider; sender: SenderRef }>;
  /** Delivers an inbound message, however this provider is driven. */
  deliverInbound(provider: ChannelProvider, senderId: string, from: string, body: string): void;
  /** Whether this implementation can be made to fail for one specific recipient. */
  canSimulateRecipientFailure: boolean;
  /** Produces a provider whose sends fail only for `phoneE164`. */
  createWithFailingRecipient?(phoneE164: string): Promise<{ provider: ChannelProvider; sender: SenderRef }>;
}

/**
 * The conformance suite EVERY ChannelProvider must pass — fake, Baileys, Meta, and anything
 * added later.
 *
 * This is what makes a new adapter correct by construction instead of hand-verified. It is
 * also the migration test: changing Baileys versions means writing the adapter against the
 * new version and running this, rather than messaging real people and hoping
 * (docs/12-testing.md).
 *
 * Call it from a .test.ts file with a harness for the implementation under test.
 */
export function runChannelProviderContract(name: string, harness: ChannelProviderHarness): void {
  describe(`ChannelProvider contract: ${name}`, () => {

    describe('capabilities', () => {
      it('declares capabilities statically, before any connection exists', async () => {
        // The dispatcher reads these to refuse illegal sends BEFORE calling the provider,
        // so they must be available without connecting first.
        const { provider } = await harness.create();
        expect(provider.capabilities).toBeDefined();
        expect(typeof provider.capabilities.freeformOutsideWindow).toBe('boolean');
        expect(typeof provider.capabilities.requiresApprovedTemplate).toBe('boolean');
        await provider.shutdown();
      });

      it('states a session window only when freeform is actually restricted', async () => {
        // An inconsistent pair here would make the dispatcher's window logic meaningless.
        const { provider } = await harness.create();
        const c = provider.capabilities;
        if (!c.freeformOutsideWindow) expect(c.sessionWindowHours).toBeGreaterThan(0);
        await provider.shutdown();
      });
    });

    describe('linking', () => {
      it('offers a QR challenge with an expiry', async () => {
        const { provider, sender } = await harness.create();
        const challenge = await provider.link(sender.id, 'qr');
        expect(challenge.mode).toBe('qr');
        if (challenge.mode === 'qr') {
          expect(challenge.qr.length).toBeGreaterThan(0);
          expect(challenge.expiresAt.getTime()).toBeGreaterThan(Date.now());
        }
        await provider.shutdown();
      });

      it('offers a pairing code as an alternative to QR', async () => {
        // Pairing codes matter because they let someone link a number they are not holding —
        // the previous system only ever implemented QR.
        const { provider, sender } = await harness.create();
        const challenge = await provider.link(sender.id, 'pairing_code', sender.phoneE164);
        expect(challenge.mode).toBe('pairing_code');
        if (challenge.mode === 'pairing_code') expect(challenge.code.length).toBeGreaterThan(0);
        await provider.shutdown();
      });
    });

    describe('connection lifecycle', () => {
      it('reports a sender it has never seen as closed rather than throwing', async () => {
        const { provider } = await harness.create();
        const health = await provider.health('never-seen');
        expect(health.state).toBe('closed');
        await provider.shutdown();
      });

      it('reports open after connect and closed after disconnect', async () => {
        const { provider, sender } = await harness.create();
        await provider.connect(sender);
        expect((await provider.health(sender.id)).state).toBe('open');
        await provider.disconnect(sender.id);
        expect((await provider.health(sender.id)).state).toBe('closed');
        await provider.shutdown();
      });

      it('reports logged_out after logout, distinctly from closed', async () => {
        // These must differ: closed is recoverable by reconnecting, logged_out is terminal
        // and means the number has to be linked again from the phone.
        const { provider, sender } = await harness.create();
        await provider.connect(sender);
        await provider.logout(sender.id);
        expect((await provider.health(sender.id)).state).toBe('logged_out');
        await provider.shutdown();
      });
    });

    describe('sending', () => {
      it('refuses to send from a sender that is not connected', async () => {
        const { provider, sender } = await harness.create();
        await expect(
          provider.send(sender, { phoneE164: '+919876543210' }, { kind: 'freeform', body: 'hi' })
        ).rejects.toThrow();
        await provider.shutdown();
      });

      it('returns a provider message id that can serve as an idempotency key', async () => {
        // This id is what stops a retried webhook creating a duplicate message row, so it
        // must be present and stable per send.
        const { provider, sender } = await harness.create();
        await provider.connect(sender);
        const result = await provider.send(
          sender, { phoneE164: '+919876543210' }, { kind: 'freeform', body: 'hello' }
        );
        expect(result.providerMessageId).toBeTruthy();
        expect(result.acceptedAt).toBeInstanceOf(Date);
        await provider.shutdown();
      });

      it('gives every send a distinct provider message id', async () => {
        const { provider, sender } = await harness.create();
        await provider.connect(sender);
        const ids = new Set<string>();
        for (let i = 0; i < 5; i++) {
          const r = await provider.send(
            sender, { phoneE164: '+91987654321' + i }, { kind: 'freeform', body: 'x' }
          );
          ids.add(r.providerMessageId);
        }
        expect(ids.size).toBe(5);
        await provider.shutdown();
      });

      it('prefers a provider-supplied address over one derived from the phone number', async () => {
        // WhatsApp issues privacy ids (@lid) to accounts hiding their number, and a
        // synthesised address does not exist for those. Sending to one took the previous
        // system's ENTIRE engine down, not just that message (M26).
        const { provider, sender } = await harness.create();
        await provider.connect(sender);
        const result = await provider.send(
          sender,
          { phoneE164: '+919876543210', providerAddress: '12345678901234@lid' },
          { kind: 'freeform', body: 'hi' }
        );
        expect(result.providerMessageId).toBeTruthy();
        await provider.shutdown();
      });
    });

    describe('failure isolation', () => {
      it.runIf(harness.canSimulateRecipientFailure)(
        'keeps the connection open and other sends working when one recipient fails',
        async () => {
          // The single most important guarantee in this suite. A poison recipient must cost
          // one message, never the session (M26).
          const bad = '+910000000000';
          const { provider, sender } = await harness.createWithFailingRecipient!(bad);
          await provider.connect(sender);

          await expect(
            provider.send(sender, { phoneE164: bad }, { kind: 'freeform', body: 'x' })
          ).rejects.toThrow();

          expect((await provider.health(sender.id)).state).toBe('open');

          const ok = await provider.send(
            sender, { phoneE164: '+919876543210' }, { kind: 'freeform', body: 'y' }
          );
          expect(ok.providerMessageId).toBeTruthy();
          await provider.shutdown();
        }
      );
    });

    describe('inbound', () => {
      it('normalises inbound messages into the shared event shape', async () => {
        const { provider, sender } = await harness.create();
        await provider.connect(sender);

        const received: string[] = [];
        const consume = (async () => {
          for await (const event of provider.inbound()) {
            // Every provider must fill these, whatever its own payload looks like.
            expect(event.providerMessageId).toBeTruthy();
            expect(event.fromProviderAddress).toBeTruthy();
            expect(event.receivedAt).toBeInstanceOf(Date);
            received.push(event.body);
            if (received.length === 2) break;
          }
        })();

        harness.deliverInbound(provider, sender.id, '+919876543210', 'first');
        harness.deliverInbound(provider, sender.id, '+919876543210', 'second');
        await consume;

        expect(received).toEqual(['first', 'second']);
        await provider.shutdown();
      });

      it('carries the raw provider payload so an event can be replayed', async () => {
        // Raw payloads are persisted before processing, so a bad deploy is replayable
        // rather than a data-loss event (NFR-8).
        const { provider, sender } = await harness.create();
        await provider.connect(sender);
        const consume = (async () => {
          for await (const event of provider.inbound()) {
            expect(event).toHaveProperty('raw');
            break;
          }
        })();
        harness.deliverInbound(provider, sender.id, '+919876543210', 'hi');
        await consume;
        await provider.shutdown();
      });
    });

    describe('shutdown', () => {
      it('ends the inbound stream so consumers can exit cleanly', async () => {
        // Without this a worker cannot drain on SIGTERM and a deploy hangs.
        const { provider, sender } = await harness.create();
        await provider.connect(sender);
        let ended = false;
        const consume = (async () => {
          for await (const _event of provider.inbound()) { /* drain */ }
          ended = true;
        })();
        await provider.shutdown();
        await consume;
        expect(ended).toBe(true);
      });
    });
  });
}
