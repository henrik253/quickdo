/** Small display formatters shared by the components. */
import { addDays, hhmmToMin, minToHHMM, weekdayOf } from '../domain/time';
import type { Block, ISODate } from '../domain/types';

/** 40 → "40m", 60 → "1h", 100 → "1h40". Negative values keep the sign. */
export function fmtMin(min: number): string {
  const sign = min < 0 ? '-' : '';
  const abs = Math.abs(Math.round(min));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m}m`;
  if (m === 0) return `${sign}${h}h`;
  return `${sign}${h}h${String(m).padStart(2, '0')}`;
}

/** "09:00–09:40" */
export function blockRange(block: Block): string {
  return `${block.start}–${minToHHMM(hhmmToMin(block.start) + block.minutes)}`;
}

/** "HH:MM" of an ISO instant in the browser's local time (display only). */
export function hhmmOfInstant(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "today" / "tomorrow" / "Mon 21 Sep" relative to `today`. */
export function dateLabel(iso: ISODate | 'later', today: ISODate): string {
  if (iso === 'later') return 'later';
  if (iso === today) return 'today';
  if (iso === addDays(today, 1)) return 'tomorrow';
  const wd = weekdayOf(iso);
  const [, m, d] = iso.split('-').map(Number);
  return `${wd[0].toUpperCase()}${wd.slice(1)} ${d} ${MONTHS[m - 1]}`;
}

/**
 * Parse the inline reschedule syntax: `mon`…`sun`, `today`, `tomorrow`/`tmr`, `backlog`, `+2` (days),
 * or an ISO date. Returns `null` for Backlog, a date, or `undefined` when unparseable.
 */
export function parseRescheduleInput(text: string, today: ISODate): ISODate | null | undefined {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  if (t === 'backlog' || t === 'b') return null;
  if (t === 'today' || t === 't') return today;
  if (t === 'tomorrow' || t === 'tmr' || t === 'tom') return addDays(today, 1);
  const plus = /^\+(\d{1,3})$/.exec(t);
  if (plus) return addDays(today, Number(plus[1]));
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const idx = days.findIndex((d) => t === d || t.startsWith(d));
  if (idx >= 0) {
    const from = days.indexOf(weekdayOf(today));
    let delta = (idx - from + 7) % 7;
    if (delta === 0) delta = 7;
    return addDays(today, delta);
  }
  return undefined;
}

/** Parse "9", "9:30", "14:05" into "HH:MM"; undefined when unparseable. */
export function parseHHMM(text: string): string | undefined {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(text.trim());
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
