/**
 * Time helpers. Every rule that depends on "now" takes a Clock so it is testable with a fake one.
 * Dates ("YYYY-MM-DD") and wall-clock times ("HH:MM") are always in the clock's timezone;
 * calendar arithmetic on ISO dates is pure string math (no timezone involved).
 */
import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import type { Clock, HHMM, ISODate, ISOInstant, Settings, Weekday } from './types';

export const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** The clock's current calendar date in its timezone. */
export function todayISO(clock: Clock): ISODate {
  return dateOf(clock.now(), clock.tz);
}

/** The clock's current wall-clock time ("HH:MM") in its timezone. */
export function nowHHMM(clock: Clock): HHMM {
  return hhmmOf(clock.now(), clock.tz);
}

/** The clock's current instant as ISO 8601 with the timezone's offset, second precision. */
export function toInstant(clock: Clock): ISOInstant {
  return format(new TZDate(clock.now(), clock.tz), "yyyy-MM-dd'T'HH:mm:ssxxx");
}

/** Calendar date of an instant (ISO string or Date) in `tz`. */
export function dateOf(instant: ISOInstant | Date, tz: string): ISODate {
  return format(tzDate(instant, tz), 'yyyy-MM-dd');
}

function tzDate(instant: ISOInstant | Date, tz: string): TZDate {
  return instant instanceof Date ? new TZDate(instant, tz) : new TZDate(instant, tz);
}

/** Wall-clock "HH:MM" of an instant (ISO string or Date) in `tz`. */
export function hhmmOf(instant: ISOInstant | Date, tz: string): HHMM {
  return format(tzDate(instant, tz), 'HH:mm');
}

/** Offset of `tz` at `instant`, in minutes east of UTC (Europe/Berlin in summer: 120). */
export function offsetMinutes(instant: Date, tz: string): number {
  return -new TZDate(instant, tz).getTimezoneOffset();
}

function splitISO(iso: ISODate): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`invalid ISO date: ${iso}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Add `n` calendar days (may be negative) to an ISO date; pure, timezone-free. */
export function addDays(iso: ISODate, n: number): ISODate {
  const [y, m, d] = splitISO(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** Weekday of an ISO date. */
export function weekdayOf(iso: ISODate): Weekday {
  const [y, m, d] = splitISO(iso);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return WEEKDAYS[(dow + 6) % 7];
}

/** Number of days between two ISO dates (b − a). */
export function diffDays(a: ISODate, b: ISODate): number {
  const [ay, am, ad] = splitISO(a);
  const [by, bm, bd] = splitISO(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/**
 * The next date on or after `fromISO` that falls on weekday `wd`.
 * With `includeToday` false, a `fromISO` already on `wd` yields the date one week later.
 */
export function nextWeekday(fromISO: ISODate, wd: Weekday, includeToday: boolean): ISODate {
  const from = WEEKDAYS.indexOf(weekdayOf(fromISO));
  const target = WEEKDAYS.indexOf(wd);
  let delta = (target - from + 7) % 7;
  if (delta === 0 && !includeToday) delta = 7;
  return addDays(fromISO, delta);
}

/** "HH:MM" → minutes since midnight. */
export function hhmmToMin(hhmm: HHMM): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`invalid HH:MM: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes since midnight → "HH:MM" (clamped to 00:00–23:59). */
export function minToHHMM(min: number): HHMM {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(min)));
  return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}`;
}

/** Padded estimate: ceil((estimate ?? default) × factor / 5) × 5 minutes. */
export function padded(estimateMin: number | undefined, settings: Settings): number {
  const est = estimateMin ?? settings.defaultEstimateMin;
  return Math.ceil((est * settings.paddingFactor) / 5) * 5;
}

/** Round minutes up to the next 5-minute grid line. */
export function ceil5(min: number): number {
  return Math.ceil(min / 5) * 5;
}
