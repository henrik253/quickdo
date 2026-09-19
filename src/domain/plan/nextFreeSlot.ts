import type { HHMM } from '../types';
import { ceil5, hhmmToMin, minToHHMM } from '../time';

export interface Interval {
  start: HHMM;
  end: HHMM;
}

/**
 * The earliest start on the 5-minute grid, at or after `fromHHMM`, where a `minutes`-long block fits
 * before `dayEnd` without overlapping any busy interval. `null` when nothing fits.
 */
export function nextFreeSlot(
  fromHHMM: HHMM,
  minutes: number,
  busy: Interval[],
  dayEnd: HHMM,
): HHMM | null {
  const end = hhmmToMin(dayEnd);
  const intervals = busy
    .map((b) => ({ start: hhmmToMin(b.start), end: hhmmToMin(b.end) }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);
  let start = ceil5(hhmmToMin(fromHHMM));
  const need = Math.max(5, ceil5(minutes));
  for (let guard = 0; guard < 1000; guard++) {
    if (start + need > end) return null;
    const clash = intervals.find((b) => b.start < start + need && b.end > start);
    if (!clash) return minToHHMM(start);
    start = ceil5(clash.end);
  }
  return null;
}
