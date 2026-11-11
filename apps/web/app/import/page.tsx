import { redirect } from 'next/navigation';
import { listImportRuns, listSenders, listTags, CrmApiError, NotAuthenticatedError } from '@/lib/crm';
import type { ImportRun, Sender } from '@/lib/crm';
import { ImportScreen, type SendingNumber } from './import-screen';

/** Rendered on every request — an import is an action, never a cached view. */
export const dynamic = 'force-dynamic';

/** The first linked number is the one campaigns will send from. */
function sendingNumber(senders: Sender[]): SendingNumber | null {
  const linked = senders.find((s) => s.linked && s.phoneE164 !== null);
  const number = linked?.phoneE164 ?? null;
  return linked === undefined || number === null ? null : { number, label: linked.label };
}

/**
 * Import: drop a CSV or Excel sheet, check what will happen, import it, then message the people. The page reads the sending number
 * and the files imported before; everything after that happens in the screen.
 */
export default async function ImportPage() {
  let senders: Sender[] = [];
  let earlier: ImportRun[] = [];
  let tags: string[] = [];
  let failure: string | null = null;
  try {
    [senders, earlier] = await Promise.all([listSenders(), listImportRuns()]);
    // The tag names already in use, so the screen can say whether the file's tag is new. Only a hint: a failure here is not an error.
    tags = (await listTags().catch(() => [])).map((t) => t.name);
  } catch (e) {
    if (e instanceof NotAuthenticatedError) redirect('/login?next=/import');
    failure = e instanceof CrmApiError
      ? `${e.code}: ${e.message}`
      : 'Could not reach the API. Is it running? Start it with: npm run dev';
  }

  return (
    <main className="page page-full" style={{ maxWidth: '73.75rem' }}>
      <p className="text-sm text-muted">Import</p>
      <header className="mb-5 mt-3">
        <h1 className="page-title">Import contacts</h1>
        <p className="page-desc">Add the people you want to message, from a CSV or Excel sheet.</p>
      </header>
      {failure !== null ? <p className="notice notice-danger">{failure}</p> : <ImportScreen sender={sendingNumber(senders)} earlier={earlier} tags={tags} />}
    </main>
  );
}
