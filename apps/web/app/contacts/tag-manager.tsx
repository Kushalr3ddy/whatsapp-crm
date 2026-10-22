import { getMe } from '@/lib/crm';
import type { Tag } from '@/lib/crm';
import { ConfirmAction } from '@/components/confirm-action';
import { deleteTagAction } from './actions';

/** Admin-only list of tags with a delete button each. Hidden for everyone else. */
export async function TagManager({ tags }: { tags: Tag[] }) {
  const isAdmin = await getMe().then((m) => m.role === 'admin').catch(() => false);
  if (!isAdmin || tags.length === 0) return null;
  return (
    <details className="card mb-4 px-4 py-2.5 text-sm">
      <summary className="cursor-pointer font-medium">Manage tags ({tags.length})</summary>
      <ul className="mt-2 flex max-h-60 flex-col gap-1 overflow-y-auto">
        {tags.map((t) => (
          <li key={t.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate" title={t.name}>{t.name}</span>
            <span className="shrink-0 text-xs text-muted">{t.contactCount ?? 0} people</span>
            <ConfirmAction label="delete" ariaLabel={`Delete tag ${t.name}`} title="Delete this tag?"
              fields={{ tagId: t.id }} action={deleteTagAction}>
              <p>
                The tag <strong>{t.name}</strong> will be removed from the {t.contactCount ?? 0} people who have it.
                No people and no campaigns are deleted.
              </p>
            </ConfirmAction>
          </li>
        ))}
      </ul>
    </details>
  );
}
