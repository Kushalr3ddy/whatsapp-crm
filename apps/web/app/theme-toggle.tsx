'use client';

import { useEffect, useState } from 'react';

/** The three settings a viewer can choose between. `system` defers to the OS. */
export type ThemePreference = 'system' | 'light' | 'dark';

/** Where the choice is kept. Read by the inline script in the layout too — keep them in step. */
export const THEME_STORAGE_KEY = 'crm.theme';

/**
 * Applies a preference to the document.
 *
 * `system` removes the attribute rather than resolving it to a value, so the media query in
 * globals.css takes over again and the page keeps following the OS if it changes later.
 */
function apply(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);

  try {
    if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Private browsing and blocked site data both throw here. The theme still applies for
    // this page view; it simply will not be remembered, which is not worth failing over.
  }
}

/**
 * Cycles system → light → dark.
 *
 * Renders a placeholder until mounted. The server cannot know what the viewer chose — that
 * lives in their browser — so rendering the real label immediately would mismatch the server
 * HTML and React would complain about the hydration difference.
 */
export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>('system');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem(THEME_STORAGE_KEY); } catch { stored = null; }
    if (stored === 'light' || stored === 'dark') setPreference(stored);
    setMounted(true);
  }, []);

  /** Moves to the next setting and applies it immediately. */
  function cycle() {
    const next: ThemePreference =
      preference === 'system' ? 'light' : preference === 'light' ? 'dark' : 'system';
    setPreference(next);
    apply(next);
  }

  const label = preference === 'system' ? 'Auto' : preference === 'light' ? 'Light' : 'Dark';

  return (
    <button
      type="button"
      onClick={cycle}
      title={`Theme: ${label.toLowerCase()} — click to change`}
      aria-label={`Theme: ${label.toLowerCase()}. Click to change.`}
      className="rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:bg-accent-soft"
    >
      {mounted ? label : '    '}
    </button>
  );
}
