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
  { label, value, hint, tone = 'default', href, icon }: {
    label: string; value: ReactNode; hint?: ReactNode;
    tone?: 'default' | 'success' | 'warning' | 'danger'; href?: string; icon?: ReactNode;
  }
) {
  const colour = tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning'
    : tone === 'danger' ? 'text-danger' : 'text-ink';
  const body = (
    <div className="card stat-tile h-full p-4 pt-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        {icon !== undefined && (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent" aria-hidden>
            {icon}
          </span>
        )}
      </div>
      <p className={`mt-1.5 text-3xl font-semibold tabular-nums tracking-tight ${colour}`}>{value}</p>
      {hint !== undefined && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
  return href === undefined ? body : <Link href={href} className="block">{body}</Link>;
}

/** A 18px stroke icon for stat tiles and the checklist. Decorative; the label next to it carries the meaning. */
export function GlyphIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

/** One step of a getting-started checklist. */
export interface ChecklistStep { label: string; hint: string; href: string; done: boolean; cta: string }

/**
 * A "getting started" card: the first things to do in a new install, with the finished ones ticked and
 * a link to the next. Reads as a progress bar plus a short list, and the page hides it when all are done.
 */
export function Checklist({ steps }: { steps: ChecklistStep[] }) {
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  return (
    <section className="card mb-8 overflow-hidden" aria-label="Getting started">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="font-heading text-xl font-semibold">Getting started</h2>
          <p className="text-sm text-muted">{done} of {steps.length} done. A few steps to a working inbox.</p>
        </div>
        <div className="w-40"><Meter value={done} max={steps.length} label="Getting started progress" /></div>
      </div>
      <ol className="divide-y divide-border">
        {steps.map((step) => (
          <li key={step.label} className="flex items-center gap-3 px-5 py-3">
            <span
              aria-hidden
              className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                step.done ? 'border-transparent bg-accent text-on-accent' : 'border-border text-muted'}`}
            >
              {step.done ? '✓' : ''}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block font-medium ${step.done ? 'text-muted line-through' : ''}`}>{step.label}</span>
              <span className="block text-sm text-muted">{step.hint}</span>
            </span>
            {!step.done && (
              <Link href={step.href} className={`btn btn-sm ${step === next ? 'btn-primary' : ''}`}>{step.cta}</Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
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
      <svg className="empty-float" viewBox="0 0 96 72" width="96" height="72" fill="none" aria-hidden>
        <rect x="8" y="10" width="54" height="36" rx="10" fill="var(--color-accent-soft)" stroke="var(--color-accent)" strokeWidth="1.6" />
        <path d="M20 46 18 58l14-12" fill="var(--color-accent-soft)" stroke="var(--color-accent)" strokeWidth="1.6" strokeLinejoin="round" />
        <rect x="34" y="26" width="54" height="34" rx="10" fill="var(--color-accent)" />
        <path d="M76 60l2 10-12-10" fill="var(--color-accent)" />
        <circle cx="52" cy="43" r="3" fill="var(--color-on-accent)" /><circle cx="61" cy="43" r="3" fill="var(--color-on-accent)" opacity="0.8" /><circle cx="70" cy="43" r="3" fill="var(--color-on-accent)" opacity="0.6" />
        <circle cx="76" cy="14" r="3.5" fill="var(--color-lime)" /><circle cx="14" cy="64" r="2.5" fill="var(--color-lime)" />
      </svg>
      <p className="mt-1 font-medium">{title}</p>
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
