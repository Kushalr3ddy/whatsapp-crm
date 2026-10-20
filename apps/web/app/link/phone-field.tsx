'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CountryCode } from 'libphonenumber-js/min';
import { composeE164, dialCodes, guessCountry, readTyped, DEFAULT_COUNTRY } from '@/lib/dial-codes';

/**
 * A phone box made of a country list and a digits-only number box.
 *
 * Reports the finished `+<code><number>` (empty until a number is typed) through `onChange`. The country starts
 * on the browser's language region and can be changed; typing `+91…` or `+63…` switches it, as Google's phone box does.
 * Used where WhatsApp truly needs the number up front (linking with a code).
 */
export function PhoneField({ onChange, id }: { onChange: (e164: string) => void; id: string }) {
  const known = useMemo(() => dialCodes(typeof navigator === 'undefined' ? 'en' : navigator.language), []);
  const [country, setCountry] = useState<CountryCode>(DEFAULT_COUNTRY);
  const [national, setNational] = useState('');

  useEffect(() => { setCountry(guessCountry(navigator.languages, known)); }, [known]);
  useEffect(() => { onChange(composeE164(country, national)); }, [country, national, onChange]);

  return (
    <div className="flex gap-2">
      <select
        aria-label="Country code" value={country}
        onChange={(e) => { setCountry(e.target.value as CountryCode); }}
        className="field field-sm w-40 min-w-0"
      >
        {known.map((d) => <option key={d.code} value={d.code}>{d.name} (+{d.dial})</option>)}
      </select>
      <input
        id={id} value={national} inputMode="tel" autoComplete="tel-national" placeholder="98765 43210"
        onChange={(e) => {
          const next = readTyped(e.target.value, known, country);
          setCountry(next.country);
          setNational(next.national);
        }}
        className="field field-sm min-w-0 flex-1"
      />
    </div>
  );
}
