import { phoneCountry } from '@crm/shared';

/**
 * Recipient-timezone inference — P6 anti-ban Layer 3 (docs/08-antiban.md).
 *
 * Circadian pacing reads the *sender's* day. But a message from an Indian number to someone in
 * London lands at their 3 a.m. while it is lunchtime here. This infers the recipient's zone from
 * their phone number's country so the pacing can also respect theirs.
 *
 * It is deliberately a country table, not a geolocation: a number's country says nothing about
 * where the person is now (roaming, expats, ported numbers), and for multi-zone countries it can
 * only pick one. So it is a *conservative nudge* — it only ever slows or defers a send, never
 * speeds one up, and an unknown country falls back to no recipient adjustment at all.
 *
 * Note this is independent of where the server is hosted: the sender's day comes from the
 * explicitly configured `SEND_TIMEZONE`, the recipient's from their number, and the host's own
 * clock zone is never consulted.
 */
export const COUNTRY_TIMEZONES: Readonly<Record<string, string>> = {
  // South Asia & Middle East
  IN: 'Asia/Kolkata', PK: 'Asia/Karachi', BD: 'Asia/Dhaka', LK: 'Asia/Colombo', NP: 'Asia/Kathmandu',
  AE: 'Asia/Dubai', SA: 'Asia/Riyadh', QA: 'Asia/Qatar', KW: 'Asia/Kuwait', OM: 'Asia/Muscat',
  BH: 'Asia/Bahrain', IL: 'Asia/Jerusalem', TR: 'Europe/Istanbul', IR: 'Asia/Tehran', EG: 'Africa/Cairo',
  // East & South-East Asia, Oceania
  CN: 'Asia/Shanghai', HK: 'Asia/Hong_Kong', JP: 'Asia/Tokyo', KR: 'Asia/Seoul', SG: 'Asia/Singapore',
  MY: 'Asia/Kuala_Lumpur', TH: 'Asia/Bangkok', VN: 'Asia/Ho_Chi_Minh', PH: 'Asia/Manila',
  ID: 'Asia/Jakarta', AU: 'Australia/Sydney', NZ: 'Pacific/Auckland',
  // Europe
  GB: 'Europe/London', GG: 'Europe/London', JE: 'Europe/London', IM: 'Europe/London', IE: 'Europe/Dublin', DE: 'Europe/Berlin', FR: 'Europe/Paris', ES: 'Europe/Madrid',
  IT: 'Europe/Rome', NL: 'Europe/Amsterdam', BE: 'Europe/Brussels', CH: 'Europe/Zurich',
  AT: 'Europe/Vienna', SE: 'Europe/Stockholm', NO: 'Europe/Oslo', DK: 'Europe/Copenhagen',
  FI: 'Europe/Helsinki', PL: 'Europe/Warsaw', PT: 'Europe/Lisbon', GR: 'Europe/Athens',
  UA: 'Europe/Kyiv', RU: 'Europe/Moscow',
  // Americas (multi-zone countries use their most populous zone)
  US: 'America/New_York', CA: 'America/Toronto', MX: 'America/Mexico_City', BR: 'America/Sao_Paulo',
  AR: 'America/Argentina/Buenos_Aires', CL: 'America/Santiago', CO: 'America/Bogota', PE: 'America/Lima',
  // Africa
  NG: 'Africa/Lagos', ZA: 'Africa/Johannesburg', KE: 'Africa/Nairobi', GH: 'Africa/Accra',
  MA: 'Africa/Casablanca'
};

/** The IANA timezone inferred for an E.164 number, or null when its country is unknown or unlisted. */
export function timezoneForPhone(e164: string): string | null {
  const country = phoneCountry(e164);
  return country === null ? null : COUNTRY_TIMEZONES[country] ?? null;
}
