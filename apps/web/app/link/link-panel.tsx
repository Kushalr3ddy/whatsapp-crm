'use client';

import { useCallback, useEffect, useState } from 'react';
import { beginLink, pollLink, unlinkNumber } from '@/app/actions';
import type { LinkStatus } from '@/app/actions';
import type { LinkMode } from '@/lib/crm';

/** How often the panel asks whether a challenge or a connection has appeared. */
const POLL_MS = 2000;

/** Formats seconds as m:ss for the countdown. */
function countdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m)}:${s.toString().padStart(2, '0')}`;
}

/**
 * Starts a link and shows the challenge until the socket opens or the attempt dies.
 *
 * A WhatsApp challenge is short-lived, so the panel counts down and then says plainly that the
 * number is **not linked** rather than leaving a dead QR on screen looking hopeful. Polling
 * stops at that point: continuing would be asking the API about an attempt that cannot succeed.
 */
export function LinkPanel({ senderId, alreadyOpen }: { senderId: string; alreadyOpen: boolean }) {
  const [mode, setMode] = useState<LinkMode>('qr');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  const [unlinked, setUnlinked] = useState(false);

  /** Unlinks the number, clearing its stored credentials so a fresh link can show a new QR. */
  const unlink = useCallback(async () => {
    setUnlinking(true);
    setError(null);
    const result = await unlinkNumber(senderId);
    setUnlinking(false);
    if (!result.ok) { setError(result.error ?? 'Could not unlink.'); return; }
    setActive(false);
    setStatus(null);
    setUnlinked(true);
  }, [senderId]);

  const expired = remaining !== null && remaining <= 0 && status?.state !== 'connected';

  /** Requests a challenge and begins polling for it. */
  const start = useCallback(async () => {
    if (mode === 'pairing_code' && !/^\+[1-9]\d{6,14}$/.test(phone)) {
      setError('Enter the number in full international form, e.g. +919876543210.');
      return;
    }
    setStarting(true);
    setError(null);
    setStatus(null);
    setRemaining(null);
    const result = await beginLink(senderId, mode, mode === 'pairing_code' ? phone : undefined);
    setStarting(false);
    if (!result.ok) { setError(result.error ?? 'Could not start linking.'); return; }
    setActive(true);
  }, [senderId, mode, phone]);

  // Poll for the challenge, then for the connection.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    /** One poll cycle; stops the loop once connected. */
    const tick = async () => {
      const next = await pollLink(senderId);
      if (cancelled) return;
      setStatus(next);
      if (next.state === 'connected') { setActive(false); setRemaining(null); }
    };

    void tick();
    const timer = setInterval(() => { void tick(); }, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [active, senderId]);

  // Drive the countdown off the challenge's own expiry, ticking once a second.
  useEffect(() => {
    if (status?.expiresAt === null || status?.expiresAt === undefined) return;
    const deadline = new Date(status.expiresAt).getTime();

    /** Recomputes from the deadline rather than decrementing, so a slow tab cannot drift. */
    const update = () => {
      setRemaining(Math.max(0, Math.round((deadline - Date.now()) / 1000)));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => { clearInterval(timer); };
  }, [status?.expiresAt]);

  // Once it has expired there is nothing left to poll for.
  useEffect(() => { if (expired) setActive(false); }, [expired]);

  // Connected either on load (the row says the socket is open) or after a link this session —
  // but once unlinked this session, no longer, so the panel flips to the link controls. The
  // `alreadyOpen` prop is a stale snapshot from page load; `unlinked` overrides it.
  const connected = !unlinked && ((alreadyOpen && status === null) || status?.state === 'connected');
  const showChallenge = active && !expired && status?.state === 'challenge_ready';

  return (
    <div className="mt-3">
      {connected && status === null && (
        <p className="text-xs text-accent">Connected. If it stops receiving, use Unlink below to reset it.</p>
      )}

      {!active && !connected && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-1.5">
            {(['qr', 'pairing_code'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError(null); }}
                className={[
                  'rounded-md border px-2.5 py-1 text-[11px]',
                  mode === m
                    ? 'border-accent bg-accent-soft text-ink'
                    : 'border-border text-muted hover:bg-accent-soft'
                ].join(' ')}
              >
                {m === 'qr' ? 'Scan a QR' : 'Type a code'}
              </button>
            ))}
          </div>

          {mode === 'pairing_code' && (
            <div>
              <input
                value={phone}
                onChange={(e) => { setPhone(e.target.value); }}
                placeholder="+919876543210"
                inputMode="tel"
                className="w-56 rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-xs outline-none focus:border-accent"
              />
              <p className="mt-1 text-[11px] text-muted">
                The number being linked. WhatsApp shows the code on <em>that</em> phone, so this
                works for a number nobody here is holding.
              </p>
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={() => { void start(); }}
              disabled={starting}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {starting ? 'Starting…' : expired ? 'Try again' : 'Link this number'}
            </button>
          </div>
        </div>
      )}

      {!active && !unlinked && (
        <div className="mt-3 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => { void unlink(); }}
            disabled={unlinking}
            className="rounded-lg border border-danger/50 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            {unlinking ? 'Unlinking…' : 'Unlink / reset this number'}
          </button>
          <p className="mt-1.5 text-[11px] text-muted">
            Use this if the number looks linked but is not receiving — it logs out and clears the
            stored credentials so linking again shows a fresh QR.
          </p>
        </div>
      )}

      {unlinked && (
        <p className="mt-2 text-xs text-accent">
          ✓ Unlinked. Link it again above to scan a fresh QR.
        </p>
      )}

      {error !== null && <p className="mt-2 text-xs text-danger">{error}</p>}

      {expired && (
        <p className="mt-2 text-xs text-danger">
          Not linked — the challenge expired before it was used. Nothing was connected; start
          again for a fresh one.
        </p>
      )}

      {status?.state === 'connected' && (
        <p className="mt-2 text-xs text-accent">
          ✓ {status.detail} Any queued message is sent by the gateway within a minute.
        </p>
      )}

      {status?.state === 'error' && <p className="mt-2 text-xs text-danger">{status.detail}</p>}

      {active && !expired && status?.state === 'pending' && (
        <p className="mt-2 text-xs text-muted">{status.detail}</p>
      )}

      {showChallenge && (
        <div className="mt-3">
          {remaining !== null && (
            <p className="mb-2 text-xs font-medium">
              Expires in <span className="tabular-nums">{countdown(remaining)}</span>
            </p>
          )}

          {status.qrDataUrl !== null && (
            <>
              {/* A plain img, not next/image: the QR is a data URL that changes every few
                  seconds, so there is nothing for the optimiser to cache or resize. */}
              <img
                src={status.qrDataUrl}
                alt="WhatsApp linking QR code"
                width={232}
                height={232}
                className="rounded-lg bg-white p-2"
              />
              <p className="mt-2 text-xs text-muted">
                WhatsApp → Settings → Linked Devices → Link a device.
              </p>
            </>
          )}

          {status.pairingCode !== null && (
            <>
              <p className="font-mono text-2xl tracking-[0.3em]">{status.pairingCode}</p>
              <p className="mt-2 text-xs text-muted">
                On {phone}: WhatsApp → Settings → Linked Devices → Link with phone number, then
                type this code.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
