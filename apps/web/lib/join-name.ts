/**
 * What the import preview shows for a name built from a first-name and a last-name column. The same rules as
 * `joinName` in `packages/core/src/ingestion.ts` (which does the real join on the server); keep the two in step.
 *
 * Never shortens a name: `Anita` + `Sharma` is `Anita Sharma`. Only a first name that is already one letter is joined
 * with a dot and no space (`a` + `sharma` is `a.sharma`). If only one part is filled in, that part is the name.
 */
export function joinNamePreview(first: string, last: string): string {
  const blank = (v: string): boolean => /^(na|n\/a|nil|null|none|-+)$/i.test(v);
  const f = blank(first.trim()) ? '' : first.trim();
  const l = blank(last.trim()) ? '' : last.trim();
  if (f === '') return l;
  if (l === '') return f;
  const initial = f.replace(/\.$/, '');
  return initial.length === 1 ? `${initial}.${l}` : `${f} ${l}`;
}
