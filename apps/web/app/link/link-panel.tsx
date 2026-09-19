'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { beginLink, pollLink } from '@/app/actions';
import type { LinkStatus } from '@/app/actions';

/** How often the panel asks the API whether a challenge or a connection has appeared. */
const POLL_MS = 2000;

/**
 * Starts a link and shows the QR until the socket opens.
 *
 * Polls rather than streams, for the same reason the inbox does: the challenge is written to a
 * database row by a separate process, and a short interval needs no connection state anywhere.
 * A WhatsApp QR is short-lived, so the panel shows its expiry and offers a fresh one rather
 * than silently displaying a code that has already died.
 */
export function LinkPanel({ senderId, alreadyOpen }: { senderId: string; alreadyOpen: boolean }) {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const expiredAt = useRef<number | null>(null);
  const [expired, setExpired] = useState(false);

  /** Requests a challenge and begins polling for it. */
  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    setExpired(false);
    expiredAt.current = null;
    const result = await beginLink(senderId);
    setStarting(false);
    if (!result.ok) { setError(result.error ?? 'Could not start linking.'); return; }
    setActive(true);
  }, [senderId]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    /** One poll cycle; stops the loop once the number is connected. */
    const tick = async () => {
      const next = await pollLink(senderId);
      if (cancelled) return;
      setStatus(next);
      if (next.expiresAt !== null) {
        expiredAt.current = new Date(next.expiresAt).getTime();
        setExpired(Date.now() > expiredAt.current);
      }
      if (next.state === 'connected') setActive(false);
    };

    void tick();
    const timer = setInterval(() => { void tick(); }, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [active, senderId]);

  if (alreadyOpen && status === null) {
    return <p className="mt-3 text-xs text-accent">Connected. Nothing to do.</p>;
  }

  return (
    <div className="mt-3">
      {!active && (
        <button
          type="button"
          onClick={() => { void start(); }}
          disabled={starting}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {starting ? 'Starting…' : status?.state === 'connected' ? 'Link again' : 'Link this number'}
        </button>
      )}

      {error !== null && <p className="mt-2 text-xs text-danger">{error}</p>}

      {status?.state === 'connected' && (
        <p className="mt-2 text-xs text-accent">
          ✓ {status.detail} Any queued message is sent by the gateway within a minute.
        </p>
      )}

      {status?.state === 'error' && <p className="mt-2 text-xs text-danger">{status.detail}</p>}

      {status?.state === 'pending' && (
        <p className="mt-2 text-xs text-muted">{status.detail}</p>
      )}

      {status?.qrDataUrl !== null && status?.qrDataUrl !== undefined && (
        <div className="mt-3">
          {/* A plain img, not next/image: the QR is a data URL that changes every few
              seconds, so there is nothing for the image optimiser to cache or resize. */}
          <img
            src={status.qrDataUrl}
            alt="WhatsApp linking QR code"
            width={232}
            height={232}
            className={[
              'rounded-lg bg-white p-2 transition-opacity',
              expired ? 'opacity-30' : 'opacity-100'
            ].join(' ')}
          />
          <p className="mt-2 text-xs text-muted">
            {expired
              ? 'This QR has expired. Click "Link this number" for a fresh one.'
              : 'Scan from WhatsApp → Settings → Linked Devices. It expires quickly.'}
          </p>
        </div>
      )}

      {status?.pairingCode !== null && status?.pairingCode !== undefined && (
        <p className="mt-3 font-mono text-lg tracking-widest">{status.pairingCode}</p>
      )}
    </div>
  );
}
