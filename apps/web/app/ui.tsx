import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * Small presentational pieces shared by every screen. No data, no behaviour — they exist so a page
 * is a composition of named parts (header, stat, section, empty state) rather than a pile of
 * utility classes, and so the product reads as one thing.
 */

/** The title row at the top of a page: heading, one line of context, and the page's main actions. */
export function PageHeader(
  { title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }
) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {description !== undefined && <p className="page-desc max-w-2xl">{description}</p>}
      </div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** One headline number with a label and an optional hint — the building block of an overview. */
export function Stat(
  { label, value, hint, tone = 'default', href }: {
    label: string; value: ReactNode; hint?: ReactNode;
    tone?: 'default' | 'success' | 'warning' | 'danger'; href?: string;
  }
) {
  const colour = tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning'
    : tone === 'danger' ? 'text-danger' : 'text-ink';
  const body = (
    <div className="card h-full p-4 transition-colors hover:border-accent/50">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1.5 text-3xl font-semibold tabular-nums tracking-tight ${colour}`}>{value}</p>
      {hint !== undefined && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
  return href === undefined ? body : <Link href={href} className="block">{body}</Link>;
}

/** A titled block on a page, with an optional action on the right of the title. */
export function Section(
  { title, action, children }: { title: string; action?: ReactNode; children: ReactNode }
) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** What a list says when it has nothing in it — and what to do about that. */
export function EmptyState(
  { title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }
) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className="avatar size-11" aria-hidden>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7h16M4 12h10M4 17h6" />
        </svg>
      </span>
      <p className="font-medium">{title}</p>
      {body !== undefined && <p className="max-w-md text-sm text-muted">{body}</p>}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** One or two letters for an avatar: first letters of the first two words, or a number's last digits. */
export function initialsOf(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (/^\d+$/.test(words[0]!)) return words[0]!.slice(-2);
  return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

/** A thin progress bar. `value` and `max` are counts; the label is read by screen readers. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div
      role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}
      className="h-1.5 w-full overflow-hidden rounded-full bg-border"
    >
      <div className="h-full rounded-full bg-accent" style={{ width: `${String(pct)}%` }} />
    </div>
  );
}
