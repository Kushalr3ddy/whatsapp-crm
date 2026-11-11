import type { CampaignEta } from './crm';

/** The install's time zone for dates on the campaign screens (SEND_TIMEZONE), or UTC if it is not valid. */
export function campaignZone(wanted: string | undefined = process.env.SEND_TIMEZONE ?? 'Asia/Kolkata'): string {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: wanted });
    return wanted;
  } catch {
    return 'UTC';
  }
}

/** "2 Nov 2026, 9:38 pm": no seconds, and the month is a word so day and month cannot be swapped. */
export function formatWhen(iso: string, timeZone: string = campaignZone()): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone
  });
}

/**
 * "Finishes about 2:52 pm · 38 min left" for a campaign that is sending, or null when there is no estimate.
 * The date is added only when the finish is not today.
 */
export function etaLine(eta: CampaignEta | null, now: Date = new Date(), timeZone: string = campaignZone()): string | null {
  if (eta === null || eta.finishAt === null) return null;
  const finish = new Date(eta.finishAt);
  const mins = Math.max(0, Math.ceil((finish.getTime() - now.getTime()) / 60_000));
  const day = (d: Date): string => d.toLocaleDateString('en-GB', { timeZone });
  const time = finish.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone });
  const at = day(finish) === day(now)
    ? time
    : `${finish.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone })}, ${time}`;
  const left = mins < 60 ? `${String(mins)} min left` : `${String(Math.floor(mins / 60))} h ${String(mins % 60)} min left`;
  return `Finishes about ${at} · ${left}`;
}
