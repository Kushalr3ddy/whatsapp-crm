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

/** Fills `{{name}}`-style variables from `vars` (keyed lowercase); an unknown key becomes empty. */
export function fillVariables(text: string, vars: Record<string, string>): string {
  return text.replace(VARIABLE, (_match, key: string) => vars[key.toLowerCase()] ?? '');
}

/**
 * Renders one recipient's copy of a campaign body: spintax first, then variables. Pure and
 * `random`-injectable, so a test can pin the spintax choice.
 */
export function renderBody(
  template: string, vars: Record<string, string>, random: () => number = Math.random
): string {
  return fillVariables(resolveSpintax(template, random), vars);
}
