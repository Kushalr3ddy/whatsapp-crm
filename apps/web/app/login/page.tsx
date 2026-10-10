import { LoginForm } from './login-form';

/** Rendered per request: whether someone is signed in is never a build-time fact. */
export const dynamic = 'force-dynamic';

/** The sign-in screen: one centred card, nothing else to look at. */
export default function LoginPage() {
  return (
    <main className="flex min-h-full w-full items-center justify-center px-5 py-16">
      <div className="card w-full max-w-sm p-7">
        <div className="mb-6 flex items-center gap-3">
          <span className="avatar size-10 text-base" aria-hidden>W</span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
            <p className="text-sm text-muted">WhatsApp CRM</p>
          </div>
        </div>
        <LoginForm />
        <p className="mt-5 text-xs text-muted">
          There is no self-service password reset yet. An administrator can set one with{' '}
          <code>npm run admin -- password</code>.
        </p>
      </div>
    </main>
  );
}
