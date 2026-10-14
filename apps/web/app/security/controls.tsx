'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setPausedAction, verifyAction } from './actions';
import type { EncryptionVerify } from '@/lib/crm';

/**
 * Re-reads the page every few seconds while the background job is running, so the progress bar
 * moves without anyone reloading. Does nothing once it is not running.
 */
export function RefreshWhile({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => { router.refresh(); }, 4000);
    return () => { clearInterval(timer); };
  }, [active, router]);
  return null;
}

/** Pause / resume for the re-encryption, with the rejection shown next to it. */
export function PauseControl({ paused }: { paused: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button" disabled={pending} className="btn btn-sm"
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await setPausedAction(!paused);
            if (!r.ok) setError(r.error ?? 'Could not change that.');
          });
        }}
      >
        {paused ? 'Resume re-encryption' : 'Pause re-encryption'}
      </button>
      {error !== null && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}

/**
 * Runs the verification and shows the answer in plain words. A pass is "every value I sampled
 * decrypted"; the page never claims more than that.
 */
export function VerifyControl({ disabled }: { disabled: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<EncryptionVerify | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div>
        <button
          type="button" disabled={disabled || pending} className="btn btn-primary text-ink"
          onClick={() => {
            setError(null);
            start(async () => {
              const r = await verifyAction();
              if (r.ok && r.verify !== undefined) setResult(r.verify);
              else setError(r.error ?? 'Verification failed to run.');
            });
          }}
        >
          {pending ? 'Checking…' : 'Verify with the new key'}
        </button>
      </div>
      {error !== null && <p className="notice notice-danger">{error}</p>}
      {result !== null && (
        result.failed === 0 && result.onOldKey === 0 ? (
          <p className="notice" role="status">
            ✓ All {result.checked} sampled value{result.checked === 1 ? '' : 's'} opened with the current
            key, and none are still on a retired key.
          </p>
        ) : (
          <p className="notice notice-danger" role="alert">
            {result.failed > 0 && <>✗ {result.failed} of {result.checked} sampled values could not be read. Do not remove the retired key. </>}
            {result.onOldKey > 0 && <>{result.onOldKey} sampled value{result.onOldKey === 1 ? ' is' : 's are'} still on a retired key; let the re-encryption finish first.</>}
          </p>
        )
      )}
    </div>
  );
}
