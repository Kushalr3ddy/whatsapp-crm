/**
 * Placeholders in the AI assistant's instructions (F12).
 *
 * An admin may write `{{name}}`, `{{org}}` or any custom field key (`{{city}}`) in the instructions; each chat
 * reply fills them from that chat's contact before the model sees them. Same `{{…}}` syntax as campaign bodies
 * (`body-variation.ts`), including the optional `contact.` prefix.
 *
 * The values are contact data (a spreadsheet's cells), so they are untrusted, and here they land in the system
 * text. Each value is therefore flattened to one short line with no braces: it can read as a word or a phrase in
 * a sentence, never as a new paragraph of instructions or another placeholder. A missing value becomes
 * "(not known)" rather than vanishing, so the model sees that it is missing and can ask for it.
 */

/** Matches a `{{name}}` / `{{contact.city}}` placeholder, capturing the key. */
const PLACEHOLDER = /\{\{\s*(?:contact\.)?(\w+)\s*\}\}/gi;

/** What a placeholder becomes when the contact has no value for it. */
export const NOT_KNOWN = '(not known)';

/** The longest value put into the instructions, in characters. */
const MAX_VALUE_CHARS = 100;

/** One line, no braces, at most 100 characters: safe to drop into the middle of a sentence. */
export function cleanInstructionValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
  return text.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_VALUE_CHARS).trim();
}

/** The values one chat offers: the contact's custom fields, then `name` and `org` (which a field cannot replace). */
export function instructionVars(
  contact: { name: string | null; customFields: Record<string, unknown> | null }, orgName: string
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(contact.customFields ?? {})) vars[k.toLowerCase()] = cleanInstructionValue(v);
  vars.name = cleanInstructionValue(contact.name);
  vars.org = cleanInstructionValue(orgName);
  return vars;
}

/** Fills every placeholder in `instructions`; an unknown or empty one becomes "(not known)". */
export function fillInstructions(instructions: string, vars: Record<string, string>): string {
  return instructions.replace(PLACEHOLDER, (_match, key: string) => {
    const value = vars[key.toLowerCase()] ?? '';
    return value === '' ? NOT_KNOWN : value;
  });
}
