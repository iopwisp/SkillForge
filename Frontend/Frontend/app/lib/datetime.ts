/**
 * Datetime helpers used by the DateTimePicker component (and the
 * forms that consume it). Pure functions, no React.
 *
 * All functions operate in the local timezone; ISO conversion is left
 * to the caller via `Date#toISOString()`.
 */

export function addMinutes(d: Date, m: number): Date {
  return new Date(d.getTime() + m * 60_000);
}

export function addDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * Returns the current wall-clock time rounded UP to the next 5-minute
 * boundary, with seconds and milliseconds zeroed. If `now` already lies
 * exactly on a 5-minute boundary, advance to the next one so the
 * result is strictly in the future. Used by the picker's "Now" preset
 * to keep validators that require `startsAt > now` happy.
 */
export function nextRoundedFiveMinutes(now: Date = new Date()): Date {
  const next = new Date(now.getTime());
  next.setSeconds(0, 0);
  const m = next.getMinutes();
  const remainder = m % 5;
  next.setMinutes(remainder === 0 ? m + 5 : m + (5 - remainder));
  return next;
}

/** Tomorrow at 09:00 local time. */
export function tomorrow9am(now: Date = new Date()): Date {
  const next = addDays(now, 1);
  next.setHours(9, 0, 0, 0);
  return next;
}

/** Next Monday at 09:00 local time (or the Monday after, if today is Monday). */
export function nextMondayMorning(now: Date = new Date()): Date {
  const next = new Date(now.getTime());
  next.setHours(9, 0, 0, 0);
  // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const day = next.getDay();
  const daysUntilMon = day === 1 ? 7 : (8 - day) % 7;
  next.setDate(next.getDate() + (daysUntilMon === 0 ? 7 : daysUntilMon));
  return next;
}

/**
 * Compact "Apr 15 — 14:30" formatting in the user's locale. Used for
 * the trigger label so it stays narrow inside form rows.
 */
export function formatDateTimeShort(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
  return `${date} — ${time}`;
}

/**
 * Slightly richer "Wed, Apr 15 — 14:30" used by the trigger when the
 * row has more horizontal room.
 */
export function formatDateTimeWithWeekday(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = new Intl.DateTimeFormat(undefined, {
    weekday: "short", month: "short", day: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
  return `${date} — ${time}`;
}

/** Round minutes to the nearest 5 (clamped to 0–59). */
export function roundMinutesToFive(m: number): number {
  if (!Number.isFinite(m)) return 0;
  const clamped = Math.max(0, Math.min(59, Math.round(m)));
  return Math.round(clamped / 5) * 5 % 60;
}
