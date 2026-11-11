/**
 * The custom-field values a Contacts form changed. The form carries each field twice: `f_<key>` is what the box holds now and
 * `o_<key>` is what it held when the page was drawn. Only a field whose box differs from that is saved (R-044): re-sending a field the
 * person never touched put the old value back over a colleague's newer one.
 */
export function changedFields(entries: Iterable<[string, FormDataEntryValue]>): Record<string, string> {
  const now: Record<string, string> = {};
  const was: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (typeof value !== 'string') continue;
    if (name.startsWith('f_')) now[name.slice(2)] = value;
    else if (name.startsWith('o_')) was[name.slice(2)] = value;
  }
  const changed: Record<string, string> = {};
  for (const [key, value] of Object.entries(now)) {
    if (value !== (was[key] ?? '')) changed[key] = value;
  }
  return changed;
}
