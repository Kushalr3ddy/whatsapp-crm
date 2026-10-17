import { LoginForm } from './login-form';

/** Rendered per request: whether someone is signed in is never a build-time fact. */
export const dynamic = 'force-dynamic';

/**
 * The sign-in screen: the form on one side, and on wide screens a panel saying what the product is
 * for, so the first thing someone sees is not a bare box.
 */
export default function LoginPage() {
  return (
    <main className="grid min-h-full w-full lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3">
            <span className="avatar size-10 text-base" aria-hidden>W</span>
            <span className="text-lg font-semibold tracking-tight">WhatsApp CRM</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mb-6 mt-1 text-muted">Welcome back. Enter your details to continue.</p>
          <LoginForm />
          <p className="mt-6 text-xs text-muted">
            There is no self-service password reset yet. Ask an administrator to set a new password for you
            from the Team page.
          </p>
        </div>
      </section>

      <aside
        aria-hidden
        className="hidden flex-col justify-between bg-accent p-12 text-on-accent lg:flex"
      >
        <p className="text-sm font-medium opacity-80">One inbox. Every number. Paced to stay safe.</p>
        <div className="flex flex-col gap-6">
          <h2 className="max-w-md text-4xl font-semibold leading-tight tracking-tight">
            Talk to everyone you work with, from one place.
          </h2>
          <ul className="flex max-w-md flex-col gap-3 text-base opacity-90">
            <li>A shared inbox with assignment, notes and saved replies.</li>
            <li>Campaigns paced by an anti-ban engine, not blasted.</li>
            <li>Tags, segments and imports to keep your book organised.</li>
          </ul>
        </div>
        <p className="text-sm opacity-70">Built for teams that rely on WhatsApp.</p>
      </aside>
    </main>
  );
}
