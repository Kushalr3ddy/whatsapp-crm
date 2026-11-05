import type { QuietHoursSetting } from '../antiban.js';

/** Minutes since local midnight for an `HH:MM` string, or null if it is not one. */
function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (m === null) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
}

/** The local hour and minute of an instant in a time zone, or null if the zone is not one this runtime knows. */
function localMinutes(at: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at);
    const h = Number(parts.find((p) => p.type === 'hour')?.value);
    const m = Number(parts.find((p) => p.type === 'minute')?.value);
    return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
  } catch {
    return null;
  }
}

/**
 * When the quiet hours that `now` falls in end, or null when it is not quiet hours (or they are off, or the setting cannot be
 * read: a broken setting must never stop a number from sending). The window may cross midnight; start is inclusive, end is not.
 */
export function quietHoursEnd(now: Date, setting: QuietHoursSetting): Date | null {
  if (!setting.enabled) return null;
  const start = minutesOf(setting.start);
  const end = minutesOf(setting.end);
  const local = localMinutes(now, setting.timeZone);
  if (start === null || end === null || local === null || start === end) return null;
  const inside = start < end ? local >= start && local < end : local >= start || local < end;
  if (!inside) return null;
  const minutesLeft = (end - local + 1440) % 1440;
  // Counted from the start of the current minute, which is what `local` is the reading of.
  const startOfMinute = now.getTime() - (now.getTime() % 60_000);
  return new Date(startOfMinute + minutesLeft * 60_000);
}
