import { ComingSoon } from '../coming-soon';

/** Broadcast. Deliberately its own section rather than something living inside the inbox. */
export default function BroadcastPage() {
  return (
    <ComingSoon
      title="Broadcast"
      blurb="Sending one message to many people. A separate place from the inbox on purpose — a campaign to 500 contacts would otherwise bury every real conversation under 500 threads."
      items={[
        'Segments: who receives it, built from contact fields and tags',
        'A dry run that shows exactly who would be messaged, before anything sends',
        'Pacing, quiet hours and per-number daily caps — the anti-ban engine',
        'Per-recipient status, so a failure is attributable rather than a total',
        'Pause, resume, and surviving a restart without sending anything twice'
      ]}
      warning="Not buildable yet, and not safe to fake. There is no rate limiting anywhere in the send path — a bulk send today would be the fastest way to get the number banned."
    />
  );
}
