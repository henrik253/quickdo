/**
 * The done tracker: how many items were finished per day (or per week) over a chosen range.
 * Source of truth is the history log (`done` / `undone` events carry the calendar day), so items
 * that were archived out of todos.json still count.
 */
import { addDays, diffDays, weekdayOf } from '../time';
import type { DoneStats, HistoryEvent, ISODate, StatsBucket, StatsRange } from '../types';

export const STATS_RANGES: readonly StatsRange[] = ['3d', '7d', '1m', '3m'];

export function isStatsRange(v: unknown): v is StatsRange {
  return typeof v === 'string' && (STATS_RANGES as readonly string[]).includes(v);
}

/** Days covered by a range, ending today. */
export function rangeDays(range: StatsRange): number {
  switch (range) {
    case '3d':
      return 3;
    case '7d':
      return 7;
    case '1m':
      return 30;
    case '3m':
      return 91; // 13 weeks
  }
}

/**
 * Net "done" per day: a `done` event counts, a later `undone` on the same item and day cancels it,
 * a `done` after that counts again. Repeat items (habits) count once per day like everything else.
 */
export function doneDays(history: HistoryEvent[]): Map<ISODate, Set<string>> {
  const byDay = new Map<ISODate, Set<string>>();
  const sorted = [...history].sort((a, b) => a.ts.localeCompare(b.ts));
  for (const ev of sorted) {
    if (!ev.itemId) continue;
    if (ev.type === 'done') {
      let set = byDay.get(ev.day);
      if (!set) {
        set = new Set();
        byDay.set(ev.day, set);
      }
      set.add(ev.itemId);
    } else if (ev.type === 'undone') {
      byDay.get(ev.day)?.delete(ev.itemId);
    }
  }
  return byDay;
}

const WEEKDAY_LABEL: Record<string, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

function dayLabel(day: ISODate, range: StatsRange): string {
  if (range === '3d' || range === '7d') return WEEKDAY_LABEL[weekdayOf(day)];
  return String(Number(day.slice(8, 10))); // day of month
}

export function buildStats(history: HistoryEvent[], today: ISODate, range: StatsRange): DoneStats {
  const days = rangeDays(range);
  const from = addDays(today, -(days - 1));
  const counts = doneDays(history);
  const countOn = (day: ISODate) => counts.get(day)?.size ?? 0;
  const buckets: StatsBucket[] = [];
  if (range === '3m') {
    // 13 weeks, each ending on a day of the same weekday as today
    for (let w = 12; w >= 0; w--) {
      const end = addDays(today, -7 * w);
      const start = addDays(end, -6);
      let done = 0;
      for (let d = start; d <= end; d = addDays(d, 1)) done += countOn(d);
      buckets.push({
        start,
        end,
        label: `${Number(end.slice(5, 7))}/${Number(end.slice(8, 10))}`,
        done,
      });
    }
  } else {
    for (let d = from; d <= today; d = addDays(d, 1)) {
      buckets.push({ start: d, end: d, label: dayLabel(d, range), done: countOn(d) });
    }
  }
  const total = buckets.reduce((sum, b) => sum + b.done, 0);
  const best = buckets.reduce((max, b) => Math.max(max, b.done), 0);
  const spanDays = diffDays(from, today) + 1;
  return {
    range,
    unit: range === '3m' ? 'week' : 'day',
    from,
    to: today,
    buckets,
    total,
    best,
    perDay: Math.round((total / spanDays) * 10) / 10,
  };
}
