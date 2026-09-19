import { describe, expect, it } from 'vitest';
import type { HistoryEvent } from '../types';
import { buildStats, doneDays, rangeDays } from './stats';

const TODAY = '2026-09-18'; // Friday

function ev(type: HistoryEvent['type'], day: string, itemId: string, ts?: string): HistoryEvent {
  return { ts: ts ?? `${day}T10:00:00+02:00`, type, day, itemId };
}

describe('done tracker', () => {
  it('[F-029] nets done and undone per item and day, in event order', () => {
    const days = doneDays([
      ev('done', '2026-09-18', 'A', '2026-09-18T10:00:00+02:00'),
      ev('undone', '2026-09-18', 'A', '2026-09-18T10:05:00+02:00'),
      ev('done', '2026-09-18', 'A', '2026-09-18T10:09:00+02:00'),
      ev('done', '2026-09-18', 'B'),
      ev('done', '2026-09-17', 'A'),
      ev('added', '2026-09-17', 'C'),
    ]);
    expect(days.get('2026-09-18')?.size).toBe(2);
    expect(days.get('2026-09-17')?.size).toBe(1);
  });

  it('[F-029] daily buckets for 3d / 7d / 1m end today and carry weekday or day-of-month labels', () => {
    const history = [
      ev('done', '2026-09-18', 'A'),
      ev('done', '2026-09-16', 'B'),
      ev('done', '2026-08-25', 'C'),
    ];
    const three = buildStats(history, TODAY, '3d');
    expect(three.buckets.map((b) => b.label)).toEqual(['Wed', 'Thu', 'Fri']);
    expect(three.buckets.map((b) => b.done)).toEqual([1, 0, 1]);
    expect(three.total).toBe(2);
    expect(three.perDay).toBe(0.7);
    const week = buildStats(history, TODAY, '7d');
    expect(week.buckets).toHaveLength(7);
    expect(week.from).toBe('2026-09-12');
    expect(week.to).toBe(TODAY);
    const month = buildStats(history, TODAY, '1m');
    expect(month.buckets).toHaveLength(30);
    expect(month.buckets[0].label).toBe('20'); // 2026-08-20
    expect(month.total).toBe(3);
    expect(month.best).toBe(1);
  });

  it('[F-029] 3m gives 13 weekly buckets ending today; items done before the range are excluded', () => {
    const history = [
      ev('done', TODAY, 'A'),
      ev('done', '2026-07-01', 'B'), // inside (range starts 2026-06-20)
      ev('done', '2026-06-01', 'C'), // outside
    ];
    const q = buildStats(history, TODAY, '3m');
    expect(q.unit).toBe('week');
    expect(q.buckets).toHaveLength(13);
    expect(q.buckets[12].end).toBe(TODAY);
    expect(q.buckets[12].start).toBe('2026-09-12');
    expect(q.buckets[0].start).toBe('2026-06-20');
    expect(q.total).toBe(2);
    expect(rangeDays('3m')).toBe(91);
  });
});
