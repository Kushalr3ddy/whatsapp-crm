import { LoginForm } from './login-form';

/** Rendered per request: whether someone is signed in is never a build-time fact. */
export const dynamic = 'force-dynamic';

/** The sign-in screen. */
export default function LoginPage() {
  return (
    <main className="mx-auto flex max-w-sm flex-col gap-5 px-5 py-16">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-xs text-muted">
          There is no self-service password reset yet. An administrator can set one with{' '}
          <code>npm run admin -- password</code>.
        </p>
      </div>
      <LoginForm />
    </main>
  );
}
