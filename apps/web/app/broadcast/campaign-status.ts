/**
 * The colour and label for a campaign's status, shared by the list and the detail page.
 *
 * Its own module rather than an export from a `page.tsx`, because Next only permits the framework's
 * own named exports (`dynamic`, `metadata`, …) from a route file — anything else is a type error.
 */
export function campaignStatusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case 'running':
      return { label: 'Running', cls: 'text-accent border-accent/40 bg-accent-soft' };
    case 'paused':
      return { label: 'Paused', cls: 'text-warning border-warning/40 bg-warning-soft' };
    case 'completed':
      return { label: 'Completed', cls: 'text-muted border-border' };
    case 'cancelled':
      return { label: 'Cancelled', cls: 'text-danger border-danger/50' };
    case 'draft':
      return { label: 'Draft', cls: 'text-muted border-border' };
    default:
      return { label: status, cls: 'text-muted border-border' };
  }
}
