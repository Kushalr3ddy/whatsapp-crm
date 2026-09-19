import { ComingSoon } from '../coming-soon';

/** Billing. A placeholder so the section exists in the navigation before it does in the code. */
export default function BillingPage() {
  return (
    <ComingSoon
      title="Billing"
      blurb="Usage, invoices and plan. Nothing is charged today — this install is self-hosted and the only running cost is the server it sits on."
      items={[
        'Per-org usage: messages sent, numbers linked, storage used',
        'Meta Cloud API costs, which are per-conversation and priced by category',
        'Invoices and payment method',
        'Plan limits, once there are plans'
      ]}
    />
  );
}
