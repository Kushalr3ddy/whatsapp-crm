import type { ReactNode } from 'react';
import { LeadScene } from './login/lead-scene';
import { ThemeToggle } from './theme-toggle';

/** A tick used in the feature list. */
function Tick() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" width="18" height="18" className="mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="8.5" strokeOpacity="0.45" /><path d="m6.5 10.3 2.4 2.4 4.6-5" />
    </svg>
  );
}

/**
 * The frame shared by the sign-in and sign-up screens: the form (passed in) in a soft card on one side, and on
 * wide screens a green panel that shows what the product does as a short loop, with colour drifting behind the
 * card. All motion is CSS and stops for anyone who asked for reduced motion.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page relative grid min-h-full w-full overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div aria-hidden className="auth-blobs"><span /><span /><span /></div>

      <section className="relative z-10 flex items-center justify-center px-6 py-12">
        <div className="absolute right-4 top-4 w-36"><ThemeToggle /></div>
        <div className="auth-card w-full max-w-sm p-8">
          <div className="mb-7 flex items-center gap-3">
            <span className="avatar size-10 text-base" aria-hidden>W</span>
            <span className="text-xl font-semibold tracking-tight">WhatsApp CRM</span>
          </div>
          {children}
        </div>
      </section>

      <aside aria-hidden className="auth-aside hidden flex-col justify-between gap-6 overflow-hidden p-10 text-white lg:flex">
        <p className="relative z-10 text-sm font-medium opacity-90">One inbox. Every number.</p>
        <div className="relative z-10 flex flex-col gap-6">
          <h2 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight">
            Talk to everyone you work with, from one place.
          </h2>
          <LeadScene />
          <ul className="flex max-w-xl flex-col gap-2.5 text-[15px]">
            <li className="flex gap-2.5"><Tick /> A shared inbox with assignment, notes and saved replies.</li>
            <li className="flex gap-2.5"><Tick /> Campaigns sent a few at a time, not blasted.</li>
            <li className="flex gap-2.5"><Tick /> Tags, segments and imports to keep your book organised.</li>
          </ul>
        </div>
        <p className="relative z-10 text-sm opacity-75">Built for teams that rely on WhatsApp.</p>
      </aside>
    </main>
  );
}
