/**
 * A placeholder for a section that exists in the navigation but not yet in the code.
 *
 * Says what the section will do and, where it matters, why it is not built. An empty page that
 * only says "coming soon" invites someone to ask the same question every week.
 */
export function ComingSoon(
  { title, blurb, items, warning }:
  { title: string; blurb: string; items: string[]; warning?: string }
) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <div className="flex items-baseline gap-2">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">
          not built yet
        </span>
      </div>

      <p className="mt-2 text-sm text-muted">{blurb}</p>

      {warning !== undefined && (
        <p className="mt-4 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
          {warning}
        </p>
      )}

      <h2 className="mt-6 text-xs font-medium uppercase tracking-wide text-muted">
        What it will hold
      </h2>
      <ul className="mt-2 flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm">
            <span className="text-muted">·</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
