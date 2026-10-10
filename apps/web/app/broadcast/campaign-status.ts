/**
 * The colour and label for a campaign's status, shared by the list and the detail page.
 *
 * Its own module rather than an export from a `page.tsx`, because Next only permits the framework's
 * own named exports (`dynamic`, `metadata`, …) from a route file — anything else is a type error.
 */
export function campaignStatusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case 'running':
      return { label: 'Running', cls: 'text-accent border-transparent bg-accent-soft' };
    case 'paused':
      return { label: 'Paused', cls: 'text-warning border-transparent bg-warning-soft' };
    case 'completed':
      return { label: 'Completed', cls: 'text-success border-transparent bg-success-soft' };
    case 'cancelled':
      return { label: 'Cancelled', cls: 'text-danger border-danger/40' };
    case 'draft':
      return { label: 'Draft', cls: 'text-muted border-border' };
    default:
      return { label: status, cls: 'text-muted border-border' };
  }
}
