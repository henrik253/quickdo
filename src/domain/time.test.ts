import { describe, expect, it } from 'vitest';
import { clock, clockAt, settings } from './testing/fixtures';
import {
  addDays,
  dateOf,
  diffDays,
  hhmmOf,
  hhmmToMin,
  minToHHMM,
  nextWeekday,
  nowHHMM,
  padded,
  todayISO,
  toInstant,
  weekdayOf,
} from './time';

describe('time', () => {
  it('[F-006] padded rounds ceil(est × 1.3 / 5) × 5 and uses the default estimate', () => {
    expect(padded(30, settings)).toBe(40);
    expect(padded(10, settings)).toBe(15);
    expect(padded(60, settings)).toBe(80);
    expect(padded(5, settings)).toBe(10);
    expect(padded(undefined, settings)).toBe(40);
    expect(padded(90, settings)).toBe(120);
    expect(padded(0, settings)).toBe(0);
  });

  it('[F-004] addDays crosses month and year ends and accepts negative steps', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-09-18', 0)).toBe('2026-09-18');
    expect(addDays('2026-09-18', 30)).toBe('2026-10-18');
  });

  it('[F-004] weekdayOf and nextWeekday do calendar math', () => {
    expect(weekdayOf('2026-09-18')).toBe('fri');
    expect(weekdayOf('2026-09-20')).toBe('sun');
    expect(weekdayOf('2026-09-21')).toBe('mon');
    expect(nextWeekday('2026-09-18', 'mon', true)).toBe('2026-09-21');
    expect(nextWeekday('2026-09-18', 'fri', true)).toBe('2026-09-18');
    expect(nextWeekday('2026-09-18', 'fri', false)).toBe('2026-09-25');
    expect(nextWeekday('2026-09-18', 'thu', true)).toBe('2026-09-24');
    expect(diffDays('2026-09-18', '2026-09-21')).toBe(3);
  });

  it('[F-009] hhmm conversions round-trip and clamp', () => {
    expect(hhmmToMin('09:30')).toBe(570);
    expect(hhmmToMin('00:00')).toBe(0);
    expect(minToHHMM(570)).toBe('09:30');
    expect(minToHHMM(0)).toBe('00:00');
    expect(minToHHMM(24 * 60)).toBe('23:59');
    expect(minToHHMM(-5)).toBe('00:00');
    expect(() => hhmmToMin('9h')).toThrow();
  });

  it('[F-004] formats the clock in its timezone (todayISO, nowHHMM, toInstant)', () => {
    expect(todayISO(clock)).toBe('2026-09-18');
    expect(nowHHMM(clock)).toBe('09:12');
    expect(toInstant(clock)).toBe('2026-09-18T09:12:00+02:00');
    // 23:30 UTC on the 18th is already the 19th in Berlin
    const late = clockAt('2026-09-18T23:30:00Z');
    expect(todayISO(late)).toBe('2026-09-19');
    expect(nowHHMM(late)).toBe('01:30');
    expect(toInstant(late)).toBe('2026-09-19T01:30:00+02:00');
    // winter offset
    expect(toInstant(clockAt('2026-12-01T08:00:00Z'))).toBe('2026-12-01T09:00:00+01:00');
    // another timezone
    expect(todayISO(clockAt('2026-09-18T23:30:00Z', 'America/New_York'))).toBe('2026-09-18');
    expect(nowHHMM(clockAt('2026-09-18T23:30:00Z', 'America/New_York'))).toBe('19:30');
  });

  it('[F-004] dateOf / hhmmOf convert ISO instants with any offset into the timezone', () => {
    expect(dateOf('2026-09-18T23:30:00Z', 'Europe/Berlin')).toBe('2026-09-19');
    expect(hhmmOf('2026-09-18T23:30:00Z', 'Europe/Berlin')).toBe('01:30');
    expect(dateOf('2026-09-18T09:12:03+02:00', 'Europe/Berlin')).toBe('2026-09-18');
    expect(hhmmOf('2026-09-18T09:12:03+02:00', 'Europe/Berlin')).toBe('09:12');
    expect(dateOf(new Date('2026-09-18T22:30:00Z'), 'Europe/Berlin')).toBe('2026-09-19');
  });

  it('[F-004] handles the DST change on 2026-10-25 in Europe/Berlin', () => {
    // 00:30 UTC is 02:30 CEST (before the change), 01:30 UTC is 02:30 CET (after)
    expect(toInstant(clockAt('2026-10-25T00:30:00Z'))).toBe('2026-10-25T02:30:00+02:00');
    expect(toInstant(clockAt('2026-10-25T01:30:00Z'))).toBe('2026-10-25T02:30:00+01:00');
    expect(todayISO(clockAt('2026-10-25T01:30:00Z'))).toBe('2026-10-25');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(weekdayOf('2026-10-25')).toBe('sun');
  });
});
