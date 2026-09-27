import { ImportPanel } from './import-panel';

/** Rendered on every request — an import is an action, never a cached view. */
export const dynamic = 'force-dynamic';

/** The Import tab: upload a CSV or Excel sheet of contacts, map its columns, preview, commit. */
export default function ImportPage() {
  return <ImportPanel />;
}
