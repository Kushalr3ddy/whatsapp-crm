/** The part of a number's state that a page shows as "Linked" or not, boiled down to one string that changes when any of it does. */
export function connectionSignature(
  senders: ReadonlyArray<{ id: string; connectionState: string | null; linked: boolean }>
): string {
  return senders.map((s) => `${s.id}:${s.connectionState ?? 'none'}:${String(s.linked)}`).join('|');
}
