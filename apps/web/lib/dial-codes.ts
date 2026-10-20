import { getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js/min';

/** One entry in the country list: the ISO code, a readable name and the dialling code (no plus). */
export interface Dial { readonly code: CountryCode; readonly name: string; readonly dial: string }

/** The country used when nothing better is known. The product's own default elsewhere (`defaultCountry`). */
export const DEFAULT_COUNTRY: CountryCode = 'IN';

/** Several countries share a dialling code; when someone types `+1…` this is the one we pick first. */
const PREFERRED: Readonly<Record<string, CountryCode>> = {
  '1': 'US', '7': 'RU', '39': 'IT', '44': 'GB', '47': 'NO', '61': 'AU', '212': 'MA', '262': 'RE',
  '290': 'SH', '358': 'FI', '590': 'GP', '599': 'CW'
};

/** All countries, sorted by name. Names come from the browser's own `Intl.DisplayNames`, so they match the language. */
export function dialCodes(locale = 'en'): Dial[] {
  let names: Intl.DisplayNames | null = null;
  try { names = new Intl.DisplayNames([locale], { type: 'region' }); } catch { names = null; }
  return getCountries()
    .map((code) => ({ code, name: names?.of(code) ?? code, dial: getCountryCallingCode(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Guesses the person's country from their browser languages (`en-IN` → `IN`). No location permission is
 * asked for; the language region is a good enough hint and they can change it in the list.
 */
export function guessCountry(languages: readonly string[], known: readonly Dial[]): CountryCode {
  for (const tag of languages) {
    const region = /[-_]([A-Za-z]{2})\b/.exec(tag)?.[1]?.toUpperCase();
    if (region !== undefined && known.some((d) => d.code === region)) return region as CountryCode;
  }
  return DEFAULT_COUNTRY;
}

/**
 * Reads what was typed into the number box.
 *
 * Text that starts with `+` is taken as a full international number: the longest dialling code at the front
 * picks the country, and the rest is the national number. Anything else is just the national number. Only
 * digits are ever kept.
 */
export function readTyped(
  text: string, known: readonly Dial[], current: CountryCode
): { country: CountryCode; national: string } {
  const trimmed = text.trimStart();
  const digits = trimmed.replace(/\D/g, '');
  if (!trimmed.startsWith('+')) return { country: current, national: digits };
  for (const length of [3, 2, 1]) {
    const prefix = digits.slice(0, length);
    const matches = known.filter((d) => d.dial === prefix);
    if (matches.length === 0) continue;
    const currentHasIt = matches.find((d) => d.code === current);
    const pick = currentHasIt ?? matches.find((d) => d.code === PREFERRED[prefix]) ?? matches[0]!;
    return { country: pick.code, national: digits.slice(length) };
  }
  return { country: current, national: digits };
}

/** Builds the `+<dial><number>` form the API expects, dropping a leading 0 some countries write before the number. Empty in, empty out. */
export function composeE164(country: CountryCode, national: string): string {
  const digits = national.replace(/\D/g, '').replace(/^0+/, '');
  return digits === '' ? '' : `+${getCountryCallingCode(country)}${digits}`;
}
