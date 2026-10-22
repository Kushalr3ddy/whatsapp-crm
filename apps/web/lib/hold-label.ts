/** Plain words for why a queued message has not gone out yet (the gateway stores a short code on the message). */
export function holdLabel(reason: string | null): string {
  if (reason === null) return 'queued, not sent yet';
  if (reason === 'sender_not_connected') return 'the number isn’t connected';
  if (reason === 'quarantined') return 'the number is quarantined';
  if (reason === 'recipient_hours') return 'it’s night where they are';
  if (reason.startsWith('recovery_pause')) return 'the number is cooling off after an incident';
  if (reason.startsWith('paced:')) return 'pacing — spacing sends to protect the number';
  return reason;
}
