import type { Derived, ISODate, Item, State } from '../types';
import { hhmmToMin, minToHHMM, weekdayOf } from '../time';

export type BusyEntry = Derived['busy'][number];

export function blockEnd(block: { start: string; minutes: number }): string {
  return minToHHMM(hhmmToMin(block.start) + block.minutes);
}

/** Items whose block occupies time on `date`: open or skipped, dated on that day, with a block. */
export function blockedItemsOn(items: readonly Item[], date: ISODate): Item[] {
  return items.filter(
    (it) =>
      it.scheduledFor === date &&
      it.block !== undefined &&
      (it.status === 'open' || it.status === 'skipped'),
  );
}

/** Anchors for the weekday of `date` plus the blocks of that day's items, sorted by start. */
export function busyFor(state: State, date: ISODate, opts: { excludeId?: string } = {}): BusyEntry[] {
  const wd = weekdayOf(date);
  const out: BusyEntry[] = [];
  for (const a of state.schedule.anchors) {
    if (a.days.includes(wd)) out.push({ start: a.start, end: a.end, kind: 'anchor', label: a.name });
  }
  for (const it of blockedItemsOn(state.todos.items, date)) {
    if (it.id === opts.excludeId || !it.block) continue;
    out.push({ start: it.block.start, end: blockEnd(it.block), kind: 'block', label: it.title, id: it.id });
  }
  return out.sort((a, b) => hhmmToMin(a.start) - hhmmToMin(b.start) || a.kind.localeCompare(b.kind));
}

/** Total busy minutes inside [windowStart, windowEnd], overlapping intervals merged. */
export function busyMinutesWithin(busy: readonly BusyEntry[], windowStart: number, windowEnd: number): number {
  const clipped = busy
    .map((b) => ({ s: Math.max(hhmmToMin(b.start), windowStart), e: Math.min(hhmmToMin(b.end), windowEnd) }))
    .filter((b) => b.e > b.s)
    .sort((a, b) => a.s - b.s);
  let total = 0;
  let curS = -1;
  let curE = -1;
  for (const b of clipped) {
    if (b.s > curE) {
      if (curE > curS) total += curE - curS;
      curS = b.s;
      curE = b.e;
    } else if (b.e > curE) {
      curE = b.e;
    }
  }
  if (curE > curS) total += curE - curS;
  return total;
}
