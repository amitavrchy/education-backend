/** Platform time zone: day boundaries (streaks, daily quotas, daily challenge) follow Bangladesh time. */
export const PLATFORM_TZ = 'Asia/Dhaka';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: PLATFORM_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const hourFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: PLATFORM_TZ,
  hour: 'numeric',
  hourCycle: 'h23',
});

/** `YYYY-MM-DD` in Bangladesh time, `offsetDays` from now (same role as the frontend's dateKey). */
export function dateKey(offsetDays = 0, from = new Date()): string {
  return fmt.format(new Date(from.getTime() + offsetDays * 864e5));
}

export function hourInPlatformTz(at = new Date()): number {
  return Number(hourFmt.format(at));
}

export function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 864e5).toISOString();
}

export const nowIso = () => new Date().toISOString();
