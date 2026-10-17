import Link from 'next/link';
import { AuthShell } from '../auth-shell';
import { SignupForm } from './signup-form';

/**
 * The sign-up screen. Front end only for now: the form checks what it can in the browser and says plainly that
 * creating an account is not connected to the server yet (see D-47 for what has to be decided first).
 */
export default function SignupPage() {
  return (
    <AuthShell>
      <h1 className="text-3xl font-semibold tracking-tight">Create your account</h1>
      <p className="mb-6 mt-1 text-muted">Set up your organisation and start talking to your customers.</p>
      <SignupForm />
      <p className="mt-6 text-sm text-muted">
        Already have an account? <Link href="/login" className="font-medium text-accent hover:underline">Sign in</Link>
      </p>
    </AuthShell>
  );
}
