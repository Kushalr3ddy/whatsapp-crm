import { sql } from 'drizzle-orm';
import { createLogger, loadConfig, ConfigError } from '@crm/shared';
import {
  createDatabase, PostgresAuthStateStore, verifySchema, inspectDatabaseSecurity, resolveTenantRole
} from '@crm/db';
import { tenantDatabase } from './tenant.js';
import { localKmsFromConfig } from '@crm/kms-local';
import { BaileysChannelProvider } from '@crm/channel-baileys';
import { FakeChannelProvider } from '@crm/channel-fake';
import { storeInboundMessage, applyDeliveryStatus, storeMedia, DEFAULT_REPLY_FLOOR,
  DecryptFailureTracker, markDecryptBurst, EntropyScheduler, linkLidToPhone,
  markMessageFailedByProviderId, assertKeyRingCoversData, autoReply, sentMessageText } from '@crm/core';
import { LiveLlm } from '@crm/llm';
import { createStorage } from '@crm/storage';
import type { ChannelProvider, NormalisedInboundEvent } from '@crm/channels';
import {
  applyConnectionEvent, handleLinkRequest, handleUnlinkRequest, handleSend,
  markAllSessionsClosed, restoreSessions, sweepPendingWork,
  type WorkContext
} from './work.js';

/** A command arriving on the Postgres NOTIFY channel. */
interface GatewayCommand {
  readonly kind: 'link' | 'unlink' | 'send';
  readonly id: string;
}

/**
 * The WhatsApp gateway.
 *
 * Runs as its own process, and that is deliberate rather than incidental: it owns long-lived
 * authenticated sockets, one per number, which must not die every time the API restarts. In
 * development `npm run dev` reloads on every file save — sharing a process would drop the
 * WhatsApp connection on each keystroke (docs/04-architecture.md).
 *
 * It is also intentionally dumb. It owns sockets and knows nothing about campaigns, consent,
 * pacing or policy. Work arrives as rows in the database; results go back the same way. Every
 * safety gate lives above it in the dispatcher, so nothing can bypass them by reaching a
 * provider directly (M12).
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const db = createDatabase(config.DATABASE_URL, { max: 6 });

  // Same gate as the API: refuse to run against a database that does not match this code.
  const schema = await verifySchema(db);
  if (!schema.ok) throw new Error(schema.problem ?? 'database schema does not match this code');

  // The restricted role tenant-scoped work drops to, resolved by measuring (same as the API), so
  // every piece of per-org work runs under row-level security rather than as the connecting
  // role (D-41). Null when the connecting role is already subject to policies.
  const tenantRole = await resolveTenantRole(db, await inspectDatabaseSecurity(db));
  /** A database handle pinned to one org, for the event streams below. */
  const inOrg = (orgId: string): ReturnType<typeof createDatabase> => tenantDatabase(db, orgId, tenantRole);

  const kms = localKmsFromConfig(config);
  // The language model for the AI assistant. `none` (the default) means it never acts; a half-set config stops boot here.
  // Follows the AI settings tab: a change there applies on the next reply with no restart. A half-set file leaves the AI off rather than crashing.
  const llm = new LiveLlm({ envFile: config.LLM_ENV_FILE, base: config, onError: (m) => { logger.warn(m); } });
  // Refuse to run if the database holds data under a key this process cannot read (a retired key
  // dropped too early, D-31). Better a loud boot failure than messages that silently won't open.
  await assertKeyRingCoversData(db, kms);
  const authStore = new PostgresAuthStateStore(db, kms);
  // Layer 5: Baileys drops undecryptable frames before the app sees them, so its logger is the only
  // place a diverged session shows. Three "Bad MAC" in a minute is recorded on the session row and
  // scored by the next health sweep, which degrades the number and later lets it recover.
  const decryptTracker = new DecryptFailureTracker();
  // `GATEWAY_CHANNEL=fake` swaps in the in-memory channel so CI and local UI tests can watch a
  // broadcast really go through the engine without touching WhatsApp. Config refuses it in production.
  const useFake = config.GATEWAY_CHANNEL === 'fake';
  if (useFake) logger.warn('GATEWAY_CHANNEL=fake: nothing will be sent to WhatsApp');
  const provider: ChannelProvider = useFake
    ? new FakeChannelProvider({ autoDeliverAfterMs: 1_000 })
    : new BaileysChannelProvider({
      authStore, logger,
      onDecryptFailure: (senderId, at) => {
        if (!decryptTracker.record(senderId, at)) return;
        logger.warn({ senderId }, 'decrypt-failure burst: companion session looks diverged');
        orgForSender(db, senderId)
          .then((org) => (org === null ? undefined : markDecryptBurst(inOrg(org), senderId, at)))
          .catch((err: unknown) => {
            logger.error({ err, senderId }, 'could not record decrypt-failure burst');
          });
      },
      // A recipient could not decrypt something we sent and asks again: give the text back so it is re-sent (their phone shows
      // "Waiting for this message" until then).
      resendText: async (senderId, messageId) => {
        const org = await orgForSender(db, senderId);
        if (org === null) return undefined;
        const text = await sentMessageText(inOrg(org), kms, senderId, messageId);
        if (text !== undefined) logger.info({ senderId, messageId }, 'resending a message the recipient could not decrypt');
        return text;
      }
    });
  // Attachments land here rather than in the API, because this is the process holding the
  // connection that can fetch them — WhatsApp media is re-downloaded through the socket that
  // received it, not from a URL anyone else could call.
  const storage = createStorage(config);

  const ctx: WorkContext = {
    db, provider, logger, storage, tenantRole,
    decrypt: (cipher) => new TextDecoder().decode(kms.decrypt(cipher)),
    // The anti-ban ceilings. Configurable per deployment, but a ceiling either way — nothing
    // in the send path can raise them (docs/08-antiban.md).
    limits: {
      perMinute: config.SEND_RATE_PER_MINUTE, perDay: config.SEND_RATE_PER_DAY,
      identicalBodyCap: config.IDENTICAL_BODY_DAILY_CAP,
      circadianTimezone: config.SEND_CIRCADIAN ? config.SEND_TIMEZONE : null
    },
    contactGraph: config.CONTACT_GRAPH_GATES
      ? {
          newContactsPerHour: config.NEW_CONTACTS_PER_HOUR,
          newContactsPerDay: config.NEW_CONTACTS_PER_DAY,
          // Lower the daily allowance until recent new contacts actually reply (Layer 4).
          ...(config.NEW_CONTACT_REPLY_FLOOR ? { replyFloor: DEFAULT_REPLY_FLOOR } : {})
        }
      : null,
    // Make each send look human — a "typing…" beat before it lands (docs/08-antiban.md, D-24).
    typingSimulation: config.SEND_TYPING_SIMULATION,
    verifyFallbackNumbers: config.SEND_VERIFY_FALLBACK_NUMBERS,
    // Blue-tick inbound messages only after a human-like 10–60 min delay, in active hours.
    readReceipts: config.SEND_READ_RECEIPTS,
    // Also respect the recipient's day, inferred from their number's country.
    recipientTimezone: config.SEND_RECIPIENT_TIMEZONE,
    // Idle-time presence noise every 2–6 h per number, in active hours.
    ...(config.SEND_BACKGROUND_ENTROPY ? { entropy: new EntropyScheduler() } : {}),
    // Campaign bodies are encrypted on their way into a message, exactly like any other.
    kms,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  };

  // ── identity links: a person shared their number, so a privacy address now has one ───────
  if (provider.identityLinks) {
    void (async () => {
      for await (const link of provider.identityLinks!()) {
        try {
          const org = await orgForSender(db, link.senderId);
          if (org === null) continue;
          const outcome = await linkLidToPhone(inOrg(org), org, {
            lid: link.providerAddress, phoneE164: link.phoneE164
          });
          if (outcome !== 'nothing_to_link') {
            logger.info({ senderId: link.senderId, outcome }, 'privacy address linked to its phone number');
          }
        } catch (error) {
          logger.error({ err: error }, 'could not link a privacy address to its number');
        }
      }
    })();
  }

  // ── inbound: whatever arrives on any connected number ────────────────────────────────
  void (async () => {
    for await (const event of provider.inbound()) {
      try {
        const org = await orgForSender(db, event.senderId);
        if (org === null) {
          logger.warn({ senderId: event.senderId }, 'inbound for an unknown sender — ignoring');
          continue;
        }
        // A privacy address that WhatsApp also gave us the number for: link the two onto one contact
        // first, so this message lands on the right person instead of a number-less duplicate.
        let fromPhone = event.fromPhoneE164;
        if (fromPhone === null && event.linkedPhoneE164 !== undefined && event.linkedPhoneE164 !== null) {
          const outcome = await linkLidToPhone(inOrg(org), org, {
            lid: event.fromProviderAddress, phoneE164: event.linkedPhoneE164
          });
          if (outcome !== 'nothing_to_link') {
            logger.info({ senderId: event.senderId, outcome }, 'privacy address linked to its phone number');
          }
          fromPhone = event.linkedPhoneE164;
        }
        const stored = await storeInboundMessage(inOrg(org), kms, {
          orgId: org,
          senderIdentityId: event.senderId,
          providerMessageId: event.providerMessageId,
          fromPhoneE164: fromPhone,
          fromProviderAddress: event.fromProviderAddress,
          body: event.body,
          contentType: event.contentType,
          receivedAt: event.receivedAt
        });
        // A redelivery is not news. WhatsApp retries for up to seven days, and logging each
        // one at info level would bury the real traffic.
        if (stored.isNew) {
          logger.info(
            { senderId: event.senderId, conversationId: stored.conversationId },
            'inbound message stored'
          );
          await inOrg(org).execute(sql`
            UPDATE sender_identity SET last_inbound_at = now() WHERE id = ${event.senderId}`);

          // Only for a message that was actually inserted. A redelivery already has its file,
          // and fetching it again would cost a round trip to WhatsApp to produce a duplicate.
          if (event.mediaRef !== null && stored.messageId !== null) {
            await fetchAttachment(stored.messageId, org, event);
          }

          // The AI assistant answers only conversations assigned to it; autoReply checks that, and
          // everything else, itself. Not awaited: a slow model must never hold up the inbound stream.
          if (llm.name !== 'none' && stored.messageId !== null) {
            const conversationId = stored.conversationId;
            void autoReply({ db: inOrg(org), kms, llm }, org, conversationId, stored.messageId)
              .then((r) => {
                if (r.outcome !== 'skipped' || r.reason === 'not_text') {
                  logger.info({ conversationId, outcome: r.outcome, reason: r.reason }, 'ai assistant looked at an inbound message');
                }
              })
              .catch((error: unknown) => {
                logger.error({ conversationId, err: error instanceof Error ? error.message : String(error) }, 'ai assistant failed');
              });
          }
        }
      } catch (error) {
        // One malformed message must never stop the inbound stream.
        logger.error(
          { err: error instanceof Error ? error.message : String(error) },
          'failed to store an inbound message'
        );
      }
    }
  })();

  /**
   * Downloads one attachment and stores it, or gives up loudly without losing the message.
   *
   * Failure here must not propagate. An attachment can be unavailable for reasons that have
   * nothing to do with us — WhatsApp expires media, a sender deletes it, the socket drops
   * mid-transfer — and the text of a message whose file could not be fetched is still worth
   * keeping. The message stays, its `content_type` still says `image` or `document`, and
   * `media_id` stays null, which is exactly how the inbox knows to say an attachment exists
   * and could not be retrieved.
   */
  async function fetchAttachment(
    messageId: string, orgId: string, event: NormalisedInboundEvent
  ): Promise<void> {
    /** Records why the file is missing, so the inbox can say so (D-30). Never throws. */
    const recordFailure = async (reason: string): Promise<void> => {
      try {
        await inOrg(orgId).execute(sql`
          UPDATE message SET media_error = ${reason.slice(0, 300)}, media_failed_at = now()
          WHERE id = ${messageId} AND org_id = ${orgId}`);
      } catch (error) {
        logger.error({ messageId, err: error instanceof Error ? error.message : String(error) },
          'could not record why an attachment failed');
      }
    };

    // Three tries, a few seconds apart: a dropped socket or a slow WhatsApp media server often
    // recovers on its own. A permanent failure (expired or deleted media) just fails three times.
    const DELAYS_MS = [0, 2_000, 6_000];
    let lastReason = 'The file was no longer available from WhatsApp.';
    for (const delay of DELAYS_MS) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const media = await provider.downloadMedia(event);
        if (media === null) { lastReason = 'The file was no longer available from WhatsApp.'; continue; }

        const stored = await storeMedia(inOrg(orgId), storage, {
          orgId, messageId, bytes: media.bytes, filename: media.filename
        });
        logger.info(
          {
            messageId, mediaId: stored.mediaId, contentType: stored.contentType,
            sizeBytes: stored.sizeBytes, deduplicated: stored.deduplicated,
            // Logged when they disagree, because a mismatch is either a broken sender or an
            // attempt to have the file served as something it is not (D-11).
            declared: media.declaredContentType
          },
          'attachment stored'
        );
        return;
      } catch (error) {
        lastReason = error instanceof Error ? error.message : String(error);
        logger.warn({ messageId, err: lastReason }, 'attachment fetch attempt failed');
      }
    }
    logger.error({ messageId, err: lastReason }, 'could not fetch an attachment; the message is stored without it');
    await recordFailure(lastReason);
  }

  // ── delivery receipts ───────────────────────────────────────────────────────────────
  void (async () => {
    for await (const event of provider.status()) {
      try {
        const org = await orgForSender(db, event.senderId);
        if (org === null) continue;
        // A delivery ERROR ack from the server: the message did not go. Recorded as a failed send so
        // the health score and the restriction detector see it, instead of leaving it at "sent".
        if (event.status === 'failed') {
          await markMessageFailedByProviderId(inOrg(org), org, event.providerMessageId, 'delivery_error');
          continue;
        }
        await applyDeliveryStatus(inOrg(org), org, event.providerMessageId, event.status);
      } catch (error) {
        logger.error(
          { err: error instanceof Error ? error.message : String(error) },
          'failed to apply a delivery receipt'
        );
      }
    }
  })();

  // ── connection state ────────────────────────────────────────────────────────────────
  // Nothing else can see a socket open or close, so this stream is the only way the database —
  // and therefore the UI — learns whether a number is actually linked.
  void (async () => {
    for await (const event of provider.connections()) {
      try {
        await applyConnectionEvent(ctx, event);
      } catch (error) {
        logger.error(
          { err: error instanceof Error ? error.message : String(error) },
          'failed to record a connection state change'
        );
      }
    }
  })();

  // ── startup: reconnect, then pick up anything left behind ───────────────────────────
  // Nothing is connected until this process connects it, whatever the last run left behind —
  // including a run that was killed and never got to tidy up.
  const stale = await markAllSessionsClosed(ctx);
  if (stale > 0) logger.info({ sessions: stale }, 'cleared stale connection state from a previous run');

  const restored = await restoreSessions(ctx, useFake ? ['fake'] : ['baileys']);
  const swept = await sweepPendingWork(ctx);
  logger.info(
    { restored, pendingLinks: swept.links, pendingSends: swept.sends, role: 'gateway' },
    'gateway ready'
  );

  // ── commands from the API ───────────────────────────────────────────────────────────
  // LISTEN/NOTIFY makes the common case instant. The durable rows behind it are what make a
  // command survive this process being down, which a notification alone would not.
  await db.$client.listen('gateway', (payload) => {
    void (async () => {
      try {
        const cmd = JSON.parse(payload) as GatewayCommand;
        if (cmd.kind === 'link') await handleLinkRequest(ctx, cmd.id);
        else if (cmd.kind === 'unlink') await handleUnlinkRequest(ctx, cmd.id);
        else if (cmd.kind === 'send') await handleSend(ctx, cmd.id);
      } catch (error) {
        logger.error(
          { payload, err: error instanceof Error ? error.message : String(error) },
          'failed to handle a gateway command'
        );
      }
    })();
  });

  // A slow sweep as a safety net, in case a NOTIFY is ever missed.
  const sweepTimer = setInterval(() => {
    void sweepPendingWork(ctx).catch((error: unknown) => {
      logger.error({ err: error instanceof Error ? error.message : String(error) }, 'sweep failed');
    });
  }, config.GATEWAY_SWEEP_SECONDS * 1000);

  /** Closes sockets and the pool so a redeploy does not sever a send mid-flight. */
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'gateway shutting down');
    clearInterval(sweepTimer);
    await provider.shutdown();
    // Say so in the database too, or the UI keeps claiming these numbers are connected.
    await markAllSessionsClosed(ctx).catch(() => { /* shutting down; nothing left to do */ });
    await db.$client.end({ timeout: 5 });
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

/** Finds which tenant a sender belongs to. Cached nowhere yet; it is one indexed lookup. */
async function orgForSender(db: ReturnType<typeof createDatabase>, senderId: string): Promise<string | null> {
  const rows = await db.execute(sql`SELECT org_id AS "orgId" FROM sender_identity WHERE id = ${senderId}`);
  return (rows as unknown as Array<{ orgId: string }>)[0]?.orgId ?? null;
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    process.stderr.write(`\n${error.message}\n\n`);
  } else {
    process.stderr.write(`gateway failed to start: ${error instanceof Error ? error.stack : String(error)}\n`);
  }
  process.exit(1);
});
