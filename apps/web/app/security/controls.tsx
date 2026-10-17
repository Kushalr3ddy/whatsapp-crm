'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setPausedAction, verifyAction, generateKeyAction } from './actions';
import type { EncryptionVerify, NewEncryptionKey } from '@/lib/crm';

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

/**
 * Step 1 of the key wizard: a button that makes the new key. The key is shown once, with the exact
 * lines to put in the server's settings. The current key is never shown here; the lines say to move
 * it into the retired list yourself, which keeps the web from ever handling the key it is protecting.
 */
export function GenerateKeyControl({ disabled }: { disabled: boolean }) {
  const [pending, start] = useTransition();
  const [fresh, setFresh] = useState<NewEncryptionKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const lines = fresh === null ? '' : [
    `ENCRYPTION_KEY_VERSION=${String(fresh.version)}`,
    `ENCRYPTION_KEY=${fresh.key}`,
    `ENCRYPTION_KEYS_PREVIOUS=<existing retired keys, if any>,${String(fresh.previousVersion)}:<your current ENCRYPTION_KEY>`
  ].join('\n');

  /** Copies the lines; if the browser refuses, they are still on screen to select. */
  function copy() {
    void navigator.clipboard.writeText(lines).then(() => { setCopied(true); }, () => { setCopied(false); });
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <button
          type="button" disabled={disabled || pending} className="btn btn-primary"
          onClick={() => {
            setError(null); setCopied(false);
            start(async () => {
              const r = await generateKeyAction();
              if (!r.ok || r.newKey === undefined) { setError(r.error ?? 'Could not make a key.'); return; }
              setFresh(r.newKey);
            });
          }}
        >
          {pending ? 'Making a key…' : fresh === null ? 'Generate a new key' : 'Generate a different key'}
        </button>
      </div>
      {error !== null && <p role="alert" className="text-xs text-danger">{error}</p>}
      {fresh !== null && (
        <div role="status" className="notice notice-success flex flex-col gap-2">
          <p className="font-medium">
            Your new key is below. It is shown only now and is not stored by this page. Put these lines in the
            server&apos;s settings, then restart (step 2).
          </p>
          <pre className="overflow-x-auto rounded-lg bg-surface p-3 font-mono text-[13px] text-ink">{lines}</pre>
          <div className="flex gap-2">
            <button type="button" className="btn btn-sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            <button type="button" className="btn btn-sm" onClick={() => { setFresh(null); }}>Hide</button>
          </div>
        </div>
      )}
    </div>
  );
}
