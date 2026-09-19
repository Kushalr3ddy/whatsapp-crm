import { sql } from 'drizzle-orm';
import { createLogger, loadConfig, ConfigError } from '@crm/shared';
import { createDatabase, PostgresAuthStateStore, verifySchema } from '@crm/db';
import { LocalKms } from '@crm/kms-local';
import { BaileysChannelProvider } from '@crm/channel-baileys';
import { storeInboundMessage, applyDeliveryStatus } from '@crm/core';
import {
  applyConnectionEvent, handleLinkRequest, handleSend, restoreSessions, sweepPendingWork,
  type WorkContext
} from './work.js';

/** A command arriving on the Postgres NOTIFY channel. */
interface GatewayCommand {
  readonly kind: 'link' | 'send';
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

  const kms = new LocalKms({
    keyHex: config.ENCRYPTION_KEY,
    indexKeyHex: config.ENCRYPTION_INDEX_KEY
  });
  const authStore = new PostgresAuthStateStore(db, kms);
  const provider = new BaileysChannelProvider({ authStore, logger });

  const ctx: WorkContext = {
    db, provider, logger,
    decrypt: (cipher) => new TextDecoder().decode(kms.decrypt(cipher))
  };

  // ── inbound: whatever arrives on any connected number ────────────────────────────────
  void (async () => {
    for await (const event of provider.inbound()) {
      try {
        const org = await orgForSender(db, event.senderId);
        if (org === null) {
          logger.warn({ senderId: event.senderId }, 'inbound for an unknown sender — ignoring');
          continue;
        }
        const stored = await storeInboundMessage(db, kms, {
          orgId: org,
          senderIdentityId: event.senderId,
          providerMessageId: event.providerMessageId,
          fromPhoneE164: event.fromPhoneE164,
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
          await db.execute(sql`
            UPDATE sender_identity SET last_inbound_at = now() WHERE id = ${event.senderId}`);
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

  // ── delivery receipts ───────────────────────────────────────────────────────────────
  void (async () => {
    for await (const event of provider.status()) {
      try {
        const org = await orgForSender(db, event.senderId);
        if (org === null) continue;
        if (event.status === 'failed') continue;   // handled at send time
        await applyDeliveryStatus(db, org, event.providerMessageId, event.status);
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
  const restored = await restoreSessions(ctx);
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
  }, 60_000);

  /** Closes sockets and the pool so a redeploy does not sever a send mid-flight. */
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'gateway shutting down');
    clearInterval(sweepTimer);
    await provider.shutdown();
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
