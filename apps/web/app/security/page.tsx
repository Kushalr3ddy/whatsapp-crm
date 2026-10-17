import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getEncryptionStatus, CrmApiError, NotAuthenticatedError, type EncryptionStatus } from '@/lib/crm';
import { PageHeader, Meter } from '../ui';
import { PauseControl, VerifyControl, RefreshWhile, GenerateKeyControl } from './controls';

/** Rendered per request: the progress comes from the database. */
export const dynamic = 'force-dynamic';

/** Where a step stands: finished, the one to do now, or waiting on an earlier one. */
type StepState = 'done' | 'active' | 'todo';

/** One numbered step of the wizard: a state, a title, and whatever the person needs to do. */
function Step(
  { n, state, title, children }: { n: number; state: StepState; title: string; children: ReactNode }
) {
  const badge = state === 'done' ? 'badge badge-success' : state === 'active' ? 'badge badge-accent' : 'badge';
  return (
    <li className={`card p-5 ${state === 'todo' ? 'opacity-60' : ''}`} aria-current={state === 'active' ? 'step' : undefined}>
      <div className="flex items-center gap-3">
        <span className={badge} aria-hidden>{state === 'done' ? '✓' : n}</span>
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="sr-only">{state === 'done' ? '(done)' : state === 'active' ? '(do this now)' : '(later)'}</span>
      </div>
      <div className="mt-3 space-y-3 text-sm">{children}</div>
    </li>
  );
}

/** A copyable-looking command or settings block. */
function Code({ children }: { children: ReactNode }) {
  return <pre className="overflow-x-auto rounded-lg border border-border bg-surface p-3 text-[13px]"><code>{children}</code></pre>;
}

/** The plain-words summary line above the steps. */
function summary(s: EncryptionStatus): { tone: 'notice' | 'notice notice-danger'; text: string } {
  switch (s.stage) {
    case 'key_missing':
      return { tone: 'notice notice-danger', text: `Some data was written with key version ${s.missingVersions.join(', ')}, which this install no longer holds. That data cannot be read until the key is put back.` };
    case 'reencrypting':
      return { tone: 'notice', text: `Re-encrypting: ${s.onOld.toLocaleString()} of ${s.total.toLocaleString()} values are still on an older key. This happens in the background; nothing is down.` };
    case 'paused':
      return { tone: 'notice', text: 'Re-encryption is paused. New data is still written with the new key; the older data waits until you resume.' };
    case 'ready_to_retire':
      return { tone: 'notice', text: 'Everything is on the current key. The older key is no longer needed and can be retired once you have verified.' };
    default:
      return { tone: 'notice', text: `Everything is encrypted with key version ${String(s.currentVersion)}. You only need this wizard when you want to change the key.` };
  }
}

/**
 * The key rotation wizard (D-31): five steps from "make a new key" to "the old one is gone".
 *
 * It never handles key material. Creating the key and putting it in the server's environment are
 * done on the server, because a web page should not be able to read or write the secret; this
 * page shows where things stand, drives the re-encryption, and says what to do next.
 */
export default async function SecurityPage() {
  let s: EncryptionStatus | null = null;
  let failure: string | null = null;
  try {
    s = await getEncryptionStatus();
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?next=/security');
    failure = error instanceof CrmApiError && error.status === 403
      ? 'Only an admin can see the encryption keys.'
      : error instanceof CrmApiError ? error.message : 'Could not reach the API.';
  }

  if (s === null) {
    return (
      <main className="page page-narrow">
        <PageHeader title="Security" />
        <p className="notice notice-danger">{failure}</p>
      </main>
    );
  }

  const sum = summary(s);
  const rotating = s.retiredVersions.length > 0;
  const converting = s.stage === 'reencrypting' || s.stage === 'paused';
  const moved = s.total === 0 ? 0 : s.onCurrent;
  const next = s.currentVersion + 1;

  // Step states from where the install actually is, not from clicks.
  const step1: StepState = rotating || s.stage === 'key_missing' ? 'done' : 'active';
  const step2: StepState = rotating ? 'done' : 'todo';
  const step3: StepState = converting ? 'active' : s.stage === 'ready_to_retire' ? 'done' : 'todo';
  const step4: StepState = s.stage === 'ready_to_retire' ? 'active' : 'todo';
  const step5: StepState = s.stage === 'ready_to_retire' ? 'active' : 'todo';

  return (
    <main className="page page-narrow">
      <RefreshWhile active={s.stage === 'reencrypting'} />
      <PageHeader
        title="Encryption keys"
        description="Change the key that protects message bodies and WhatsApp sessions, without downtime and without losing anything."
      />

      <p className={sum.tone} role="status">{sum.text}</p>

      {s.stage === 'key_missing' && (
        <div className="notice notice-danger mt-4" role="alert">
          Add the missing key to <code>ENCRYPTION_KEYS_PREVIOUS</code> as <code>&lt;version&gt;:&lt;64 hex characters&gt;</code> and
          restart the API and the gateway. If it is the one you removed, restore it from your backup.
        </div>
      )}

      <dl className="mt-5 grid grid-cols-3 gap-3 text-sm">
        <div className="card p-3"><dt className="text-xs uppercase tracking-wide text-muted">Current key</dt><dd className="text-lg font-semibold tabular-nums">version {s.currentVersion}</dd></div>
        <div className="card p-3"><dt className="text-xs uppercase tracking-wide text-muted">Older keys held</dt><dd className="text-lg font-semibold tabular-nums">{s.retiredVersions.length === 0 ? 'none' : s.retiredVersions.join(', ')}</dd></div>
        <div className="card p-3"><dt className="text-xs uppercase tracking-wide text-muted">Values on current</dt><dd className="text-lg font-semibold tabular-nums">{moved.toLocaleString()} / {s.total.toLocaleString()}</dd></div>
      </dl>
      <p className="mt-2 text-xs text-muted">
        Counts are for this organisation. The key and the re-encryption job are shared by the whole install.
      </p>

      <ol className="mt-6 space-y-4">
        <Step n={1} state={step1} title="Make a new key">
          <p>
            Press the button to make a fresh key. It shows you the exact lines to use. Nothing is changed by
            pressing it, and your current key is never shown here.
          </p>
          <GenerateKeyControl disabled={s.stage === 'key_missing'} />
          <p className="text-muted">
            <strong>Back up your current key first.</strong> Until step 3 finishes, anything not yet
            re-encrypted can only be opened with it.
          </p>
        </Step>

        <Step n={2} state={step2} title="Put it in and restart">
          {rotating ? (
            <>
              <p>
                Done. This install is running key version {s.currentVersion} and still holds the retired
                version{s.retiredVersions.length === 1 ? '' : 's'} {s.retiredVersions.join(', ')} so older data stays
                readable. Its settings are:
              </p>
              <Code>{`ENCRYPTION_KEY_VERSION=${String(s.currentVersion)}\nENCRYPTION_KEY=<the current key>\nENCRYPTION_KEYS_PREVIOUS=${s.retiredVersions.map((v) => `${String(v)}:<that key>`).join(',')}`}</Code>
            </>
          ) : (
            <>
              <p>
                In <code>.env</code> (or your secret store), set the new version, the new key, and move the old
                key to the retired list. Then restart the API and the gateway. Nothing breaks: older data is read
                through the retired key, and new data is written under the new one.
              </p>
              <Code>{`ENCRYPTION_KEY_VERSION=${String(next)}\nENCRYPTION_KEY=<the new key from step 1>\nENCRYPTION_KEYS_PREVIOUS=${String(s.currentVersion)}:<the old key>`}</Code>
            </>
          )}
        </Step>

        <Step n={3} state={step3} title="Re-encrypt the existing data">
          <p>
            The gateway moves a small batch every few seconds, behind the sends, so nothing slows down.
            It can be paused and resumed; it picks up where it left off, even across restarts.
          </p>
          {rotating ? (
            <>
              <Meter value={moved} max={s.total} label="Values moved to the current key" />
              <p className="tabular-nums text-muted">
                {moved.toLocaleString()} of {s.total.toLocaleString()} moved
                {s.lastRunAt !== null && <> · last batch {new Date(s.lastRunAt).toLocaleTimeString()}</>}
                {s.lastUnreadable > 0 && <span className="text-danger"> · {s.lastUnreadable} could not be read</span>}
              </p>
              {converting && <PauseControl paused={s.paused} />}
            </>
          ) : (
            <p className="text-muted">Starts by itself after step 2.</p>
          )}
        </Step>

        <Step n={4} state={step4} title="Check that the new key opens everything">
          <p>
            This decrypts a random sample of this organisation&apos;s data with the key the app is using now, the
            same way the app reads it. It is a spot check, so it is a guide, not a proof of every value.
          </p>
          <VerifyControl disabled={!rotating && s.stage !== 'idle'} />
        </Step>

        <Step n={5} state={step5} title="Retire the old key">
          <p>
            Once step 3 reaches 100% and the check passes, remove the old key from{' '}
            <code>ENCRYPTION_KEYS_PREVIOUS</code> and restart. The app refuses to start if any data still needs
            it, so you cannot do this too early by accident.
          </p>
          <p className="text-muted">
            Keep the old key in your backup for a while longer, just in case a restored database backup
            predates the rotation.
          </p>
        </Step>
      </ol>
    </main>
  );
}
