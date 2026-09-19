/**
 * The server clock: real time in the configured timezone, or a fixed instant for tests
 * (POST /api/_test/clock). Every domain call receives this object as its `Clock`.
 */
import type { Clock, ISOInstant } from '../domain/types';

export interface ServerClock extends Clock {
  /** Pin the clock to `iso` (any Date-parsable instant); `null` returns to real time. */
  setFixed(iso: ISOInstant | null): void;
  /** The pinned instant, or null when the clock is real. */
  fixed(): ISOInstant | null;
}

export function createClock(tz: string, initialFixed: ISOInstant | null = null): ServerClock {
  let fixedAt: Date | null = initialFixed ? parseInstant(initialFixed) : null;
  return {
    tz,
    now: () => (fixedAt ? new Date(fixedAt.getTime()) : new Date()),
    setFixed(iso) {
      fixedAt = iso === null ? null : parseInstant(iso);
    },
    fixed: () => (fixedAt ? fixedAt.toISOString() : null),
  };
}

function parseInstant(iso: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid instant: ${iso}`);
  return d;
}
