import type { AiActivity, AiUsageLog } from '@/lib/crm';

/** What each kind of AI call is called, as a count: "412 openings". */
const KIND: Record<string, [string, string]> = {
  opening: ['opening', 'openings'], reply: ['reply', 'replies'], handover: ['reply with a hand-over', 'replies with a hand-over'], draft: ['template draft', 'template drafts'],
  example: ['example conversation', 'example conversations'], fillins: ['fill-in suggestion', 'fill-in suggestions'], sensitive: ['sensitive-details scan', 'sensitive-details scans'],
  rewrite: ['text rewrite', 'text rewrites'], campaign_action: ['task', 'tasks']
};

/** "3 replies", "1 opening". */
function part(kind: string, count: number): string {
  const names = KIND[kind] ?? [kind, kind];
  return `${count.toLocaleString('en-US')} ${count === 1 ? names[0] : names[1]}`;
}

/** What the activity was: the campaign, the template, or the chats that did not come from a campaign. */
function title(a: AiActivity): string {
  if (a.scope === 'campaign') return `Campaign “${a.name ?? 'removed campaign'}”`;
  if (a.scope === 'chat') return 'Chats that did not come from a campaign';
  return a.name === null ? 'A template (new or removed)' : `Template “${a.name}”`;
}

/**
 * The AI's credit log. Each line is one activity (a campaign's AI messages for a day, a person's work on a template for a day) with the
 * credits it took, who did it, and the model. 1 credit = 1 AI message the AI writes. The totals above and the lines come from the same
 * moment, so they always agree.
 */
export function UsageLog({ usage }: { usage: AiUsageLog }) {
  const fmt = (iso: string): string => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <section className="mt-10" aria-label="AI credits used">
      <h2 className="text-lg font-semibold">AI credits used</h2>
      <p className="mt-1 text-sm text-muted">1 credit = 1 AI message the AI writes (an opening, a reply, a template draft, an example). Each line below is one activity and what it took.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {([['Today', usage.today], ['This month', usage.month], ['All time', usage.total]] as const).map(([label, n]) => (
          <div key={label} className="card p-4"><span className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</span><div className="text-2xl font-semibold">{n.toLocaleString('en-US')}</div><span className="text-sm text-muted">credits</span></div>
        ))}
      </div>
      {usage.activities.length === 0
        ? <p className="card mt-3 p-4 text-sm text-muted">Nothing used yet. Each activity will be listed here with the credits it took.</p>
        : (
          <div className="card mt-3 overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">Last at</th><th className="px-4 py-2 font-semibold">Activity</th><th className="px-4 py-2 font-semibold">What it took</th>
                  <th className="px-4 py-2 font-semibold">Who</th><th className="px-4 py-2 font-semibold">Model</th><th className="px-4 py-2 text-right font-semibold">Credits</th>
                </tr>
              </thead>
              <tbody>
                {usage.activities.map((a, i) => (
                  <tr key={`${a.at}-${String(i)}`} className="border-t border-border first:border-t-0 align-top">
                    <td className="whitespace-nowrap px-4 py-2">{fmt(a.at)}</td>
                    <td className="px-4 py-2 [overflow-wrap:anywhere]">{title(a)}</td>
                    <td className="px-4 py-2 text-muted">{a.parts.map((p) => part(p.kind, p.count)).join(' · ')}<div className="text-xs">{a.tokens.toLocaleString('en-US')} tokens</div></td>
                    <td className="px-4 py-2">{a.who ?? 'AI assistant'}</td>
                    <td className="px-4 py-2 [overflow-wrap:anywhere]">{a.models.join(', ')}</td>
                    <td className="px-4 py-2 text-right font-semibold">{a.credits.toLocaleString('en-US')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-border px-4 py-2 text-xs text-muted">The latest {usage.activities.length} activities from the last 90 days. A day’s work on one campaign or template is one line.</p>
          </div>
        )}
    </section>
  );
}
