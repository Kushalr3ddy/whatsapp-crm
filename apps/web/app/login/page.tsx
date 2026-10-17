import Link from 'next/link';
import { AuthShell } from '../auth-shell';
import { LoginForm } from './login-form';

/** Rendered per request: whether someone is signed in is never a build-time fact. */
export const dynamic = 'force-dynamic';

/** The sign-in screen: the shared auth frame with the sign-in form in it. */
export default function LoginPage() {
  return (
    <AuthShell>
      <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
      <p className="mb-6 mt-1 text-muted">Welcome back. Enter your details to continue.</p>
      <LoginForm />
      <p className="mt-6 text-sm text-muted">
        New here? <Link href="/signup" className="font-medium text-accent hover:underline">Create an account</Link>
      </p>
      <p className="mt-3 text-xs text-muted">
        There is no self-service password reset yet. Ask an administrator to set a new password for you
        from the Team page.
      </p>
    </AuthShell>
  );
}
