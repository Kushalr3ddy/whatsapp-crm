/** Edit distance between two short strings (insert, delete or change one letter = 1). */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}

/**
 * The known key closest to a mistyped one, if one is within 2 edits (CW-7.7 AC3). The same rule as the server's `suggestFillIn`
 * in `packages/core/src/body-variation.ts`, kept here so the form can underline as you type without a round trip.
 */
export function suggestKey(key: string, known: readonly string[]): string | null {
  let best: string | null = null;
  let bestDistance = 3;
  for (const candidate of known) {
    const d = editDistance(key.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) { best = candidate; bestDistance = d; }
  }
  return best;
}
