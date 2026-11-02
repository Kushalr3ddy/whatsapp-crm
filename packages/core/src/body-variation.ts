/**
 * Campaign body variation — P6 anti-ban / F4 (docs/08-antiban.md, docs/21-deferred.md D-26).
 *
 * Sending byte-identical text to hundreds of people is one of the clearest "this is a bulk sender"
 * signals WhatsApp reads. This renders each recipient's copy differently in two ways:
 *
 *   **Spintax** — `{Hi|Hello|Hey}` picks one option at random, so the wording varies per send.
 *   **Variables** — `{{name}}` (or `{{contact.name}}`) is filled from the contact.
 *
 * Order matters and is deliberate: **spintax is resolved first**, on the operator-authored
 * template, then the contact's value is substituted into the chosen literal. Doing it the other way
 * would feed untrusted contact data (a display name is whatever a spreadsheet held) through the
 * spintax parser, where a stray `{` or `|` in a name would corrupt the message. The cost is that a
 * `{{variable}}` inside a spintax option is not supported — a fair trade for that safety, and the
 * common shape (`{Hi|Hey} {{name}}!`) works exactly as expected.
 */

/** Matches the innermost spintax group — a `{…|…}` with at least one pipe and no nested braces. */
const SPINTAX_GROUP = /\{([^{}]*\|[^{}]*)\}/;

/** Matches a `{{name}}` / `{{contact.name}}` variable, capturing the key. */
const VARIABLE = /\{\{\s*(?:contact\.)?(\w+)\s*\}\}/gi;

/** A generous ceiling on spintax passes, so a pathological template cannot loop forever. */
const MAX_PASSES = 1000;

/**
 * Resolves spintax by repeatedly collapsing the innermost `{a|b|c}` to one random option, so
 * nested groups resolve inside-out. Text with no spintax is returned unchanged.
 */
export function resolveSpintax(template: string, random: () => number = Math.random): string {
  let out = template;
  for (let pass = 0; pass < MAX_PASSES && SPINTAX_GROUP.test(out); pass++) {
    out = out.replace(SPINTAX_GROUP, (_match, body: string) => {
      const options = body.split('|');
      return options[Math.floor(random() * options.length)] ?? '';
    });
  }
  return out;
}

/** The fill-ins every contact has, whatever custom fields the org defines. */
export const BUILTIN_FILL_INS = ['name', 'first_name'] as const;

/** Every key a message may use as `{{key}}`: the built-in ones, then the org's custom fields (lower case, no repeats). */
export function fillInKeys(customFieldKeys: readonly string[]): string[] {
  return [...new Set([...BUILTIN_FILL_INS, ...customFieldKeys.map((k) => k.toLowerCase())])];
}

/** The fill-in keys a text uses, lower case, each once, in the order they first appear. */
export function usedFillIns(text: string): string[] {
  return [...new Set([...text.matchAll(VARIABLE)].map((m) => m[1]!.toLowerCase()))];
}

/** True when a fill-in has nothing to show: missing, empty, or only spaces. */
function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

/**
 * Fills `{{name}}`-style variables from `vars` (keyed lowercase). A blank or unknown key becomes the `fallback` when one is given
 * (CW-7.7 "use a fallback"), and empty otherwise (the old behaviour, "send anyway").
 */
export function fillVariables(text: string, vars: Record<string, string>, fallback?: string | null): string {
  return text.replace(VARIABLE, (_match, key: string) => {
    const value = vars[key.toLowerCase()];
    return fallback !== undefined && fallback !== null && fallback !== '' && isBlank(value) ? fallback : value ?? '';
  });
}

/** The keys this text uses that have no value in `vars`: one person's blanks (CW-7.7). */
export function blankFillIns(text: string, vars: Record<string, string>): string[] {
  return usedFillIns(text).filter((key) => isBlank(vars[key]));
}

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

/** The known key closest to `key` by edit distance, if one is within 2 (CW-7.7 AC3); the earlier key wins a tie. */
export function suggestFillIn(key: string, known: readonly string[]): string | null {
  let best: string | null = null;
  let bestDistance = 3;
  for (const candidate of known) {
    const d = editDistance(key.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) { best = candidate; bestDistance = d; }
  }
  return best;
}

/** The `{{keys}}` in a text that are not a known column, each with the closest known key (or null). */
export function unknownFillIns(text: string, known: readonly string[]): Array<{ key: string; suggestion: string | null }> {
  const have = new Set(known.map((k) => k.toLowerCase()));
  return usedFillIns(text).filter((k) => !have.has(k)).map((key) => ({ key, suggestion: suggestFillIn(key, known) }));
}

/**
 * Renders one recipient's copy of a campaign body: spintax first, then variables. Pure and
 * `random`-injectable, so a test can pin the spintax choice.
 */
export function renderBody(
  template: string, vars: Record<string, string>, random: () => number = Math.random, fallback?: string | null
): string {
  return fillVariables(resolveSpintax(template, random), vars, fallback);
}
