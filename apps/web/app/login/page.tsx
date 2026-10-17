import { LoginForm } from './login-form';

/** Rendered per request: whether someone is signed in is never a build-time fact. */
export const dynamic = 'force-dynamic';

/** Message snippets that drift up the right-hand panel. Decorative; they say what the product is for. */
const BUBBLES: Array<{ text: string; left: number; delay: number; duration: number; mine?: boolean }> = [
  { text: 'Hi, is this still available?', left: 6, delay: -2, duration: 19 },
  { text: 'Yes! Sending the details now', left: 52, delay: -9, duration: 22, mine: true },
  { text: 'Order confirmed ✓✓', left: 18, delay: -14, duration: 24, mine: true },
  { text: 'Thanks, see you at 5', left: 60, delay: -5, duration: 20 },
  { text: 'Can you resend the invoice?', left: 28, delay: -17, duration: 26 },
  { text: 'Done, check your inbox', left: 8, delay: -11, duration: 23, mine: true },
  { text: 'Got it!', left: 70, delay: -20, duration: 18 }
];

/** A tick used in the feature list. */
function Tick() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" width="18" height="18" className="mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="8.5" strokeOpacity="0.45" />
      <path d="m6.5 10.3 2.4 2.4 4.6-5" />
    </svg>
  );
}

/**
 * The sign-in screen: the form on one side, and on wide screens a lively panel showing what the
 * product is for: message bubbles drifting up, a small inbox preview, and the three promises.
 *
 * Everything that moves is CSS (transform and opacity only), so it costs no script and almost no
 * CPU, and it stops entirely for anyone who has asked their system for reduced motion.
 */
export default function LoginPage() {
  return (
    <main className="auth-page relative grid min-h-full w-full overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div aria-hidden className="auth-blobs"><span /><span /><span /></div>

      <section className="relative z-10 flex items-center justify-center px-6 py-16">
        <div className="auth-card w-full max-w-sm p-8">
          <div className="mb-7 flex items-center gap-3">
            <span className="avatar size-10 text-base" aria-hidden>W</span>
            <span className="font-heading text-xl font-semibold tracking-tight">WhatsApp CRM</span>
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

      <aside aria-hidden className="auth-aside relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="auth-bubbles">
          {BUBBLES.map((b) => (
            <span
              key={b.text}
              className={`auth-bubble ${b.mine === true ? 'auth-bubble-mine' : ''}`}
              style={{ left: `${String(b.left)}%`, animationDelay: `${String(b.delay)}s`, animationDuration: `${String(b.duration)}s` }}
            >
              {b.text}
            </span>
          ))}
        </div>

        <p className="relative z-10 text-sm font-medium opacity-90">One inbox. Every number. Paced to stay safe.</p>

        <div className="relative z-10 flex flex-col gap-7">
          <h2 className="font-heading max-w-md text-5xl font-semibold leading-[1.05] tracking-tight">
            Talk to everyone you work with, from one place.
          </h2>

          <div className="auth-preview max-w-md p-3">
            {[
              { n: 'Asha K.', t: 'Can you send the brochure again?', time: '2m', unread: 2 },
              { n: 'Ravi M.', t: 'Perfect, I will confirm by evening', time: '14m', unread: 0 },
              { n: 'Support line', t: 'Your order has shipped ✓✓', time: '1h', unread: 0 }
            ].map((row) => (
              <div key={row.n} className="flex items-center gap-3 rounded-lg px-2.5 py-2">
                <span className="avatar size-9 bg-white/90 text-sm text-[#0e6b3c]">{row.n.slice(0, 1)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{row.n}</span>
                  <span className="block truncate text-xs opacity-80">{row.t}</span>
                </span>
                <span className="text-xs opacity-70">{row.time}</span>
                {row.unread > 0 && <span className="rounded-full bg-white px-1.5 text-[11px] font-bold text-[#0e6b3c]">{row.unread}</span>}
              </div>
            ))}
            <div className="flex items-center gap-2 px-2.5 pb-1 pt-2 text-xs opacity-80">
              <span className="typing"><i /><i /><i /></span> Asha is typing
            </div>
          </div>

          <ul className="flex max-w-md flex-col gap-3 text-base">
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
