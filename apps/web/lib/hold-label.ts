/** Plain words for why a queued message has not gone out yet (the gateway stores a short code on the message). */
export function holdLabel(reason: string | null): string {
  if (reason === null) return 'queued, not sent yet';
  if (reason === 'sender_not_connected') return 'the number isn’t connected';
  return reason;
}
