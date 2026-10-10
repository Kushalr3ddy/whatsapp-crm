import Link from 'next/link';
import { getPublicConfig } from '@/lib/crm';
import { SignupForm } from './signup-form';

/** Rendered per request: whether signup is on is a property of the running install. */
export const dynamic = 'force-dynamic';

/**
 * Create an account: a new organisation and its first admin. Offered only when the install has
 * signup switched on; otherwise this says so and points back to sign-in.
 */
export default async function SignupPage() {
  const { signupEnabled } = await getPublicConfig();

  return (
    <main className="flex min-h-full w-full items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="avatar size-10 text-base" aria-hidden>W</span>
          <span className="text-lg font-semibold tracking-tight">WhatsApp CRM</span>
        </div>

        {signupEnabled ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
            <p className="mb-6 mt-1 text-muted">Set up an organisation and its first admin.</p>
            <SignupForm />
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Signup is not open</h1>
            <p className="mt-2 text-muted">
              This install does not take self-service signups. Ask an administrator for an account.
            </p>
          </>
        )}

        <p className="mt-6 text-sm text-muted">
          Already have an account? <Link href="/login" className="underline underline-offset-2">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
