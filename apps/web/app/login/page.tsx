import { LoginForm } from './login-form';
import { LeadScene } from './lead-scene';

/** Rendered per request: whether someone is signed in is never a build-time fact. */
export const dynamic = 'force-dynamic';

/** A tick used in the feature list. */
function Tick() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" width="18" height="18" className="mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="8.5" strokeOpacity="0.45" /><path d="m6.5 10.3 2.4 2.4 4.6-5" />
    </svg>
  );
}

/**
 * The sign-in screen: the form on one side, and on wide screens a green panel that shows what the product
 * does as a short loop (message everyone, a few reply, they are served, revenue goes up), with soft
 * colour drifting behind the form. All motion is CSS and stops for anyone who asked for reduced motion.
 */
export default function LoginPage() {
  return (
    <main className="auth-page relative grid min-h-full w-full overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div aria-hidden className="auth-blobs"><span /><span /><span /></div>

      <section className="relative z-10 flex items-center justify-center px-6 py-16">
        <div className="auth-card w-full max-w-sm p-8">
          <div className="mb-7 flex items-center gap-3">
            <span className="avatar size-10 text-base" aria-hidden>W</span>
            <span className="text-xl font-semibold tracking-tight">WhatsApp CRM</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
          <p className="mb-6 mt-1 text-muted">Welcome back. Enter your details to continue.</p>
          <LoginForm />
          <p className="mt-6 text-xs text-muted">
            There is no self-service password reset yet. Ask an administrator to set a new password for you
            from the Team page.
          </p>
        </div>
      </section>

      <aside aria-hidden className="auth-aside hidden flex-col justify-between gap-6 overflow-hidden p-10 text-white lg:flex">
        <p className="relative z-10 text-sm font-medium opacity-90">One inbox. Every number. Paced to stay safe.</p>
        <div className="relative z-10 flex flex-col gap-6">
          <h2 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight">
            Talk to everyone you work with, from one place.
          </h2>
          <LeadScene />
          <ul className="flex max-w-xl flex-col gap-2.5 text-[15px]">
            <li className="flex gap-2.5"><Tick /> A shared inbox with assignment, notes and saved replies.</li>
            <li className="flex gap-2.5"><Tick /> Campaigns paced by an anti-ban engine, not blasted.</li>
            <li className="flex gap-2.5"><Tick /> Tags, segments and imports to keep your book organised.</li>
          </ul>
        </div>
        <p className="relative z-10 text-sm opacity-75">Built for teams that rely on WhatsApp.</p>
      </aside>
    </main>
  );
}
