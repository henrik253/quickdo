import { describe, expect, it } from 'vitest';
import { nextFreeSlot } from './nextFreeSlot';

describe('nextFreeSlot', () => {
  it('[F-009] returns the start itself when nothing is busy, on the 5-minute grid', () => {
    expect(nextFreeSlot('09:12', 40, [], '22:00')).toBe('09:15');
    expect(nextFreeSlot('09:00', 40, [], '22:00')).toBe('09:00');
  });

  it('[F-012] skips anchors and blocks and lands right after the clash', () => {
    const busy = [
      { start: '09:00', end: '10:00' },
      { start: '10:30', end: '12:00' },
    ];
    expect(nextFreeSlot('09:12', 30, busy, '22:00')).toBe('10:00');
    expect(nextFreeSlot('09:12', 40, busy, '22:00')).toBe('12:00');
    expect(nextFreeSlot('10:00', 30, busy, '22:00')).toBe('10:00');
  });

  it('[F-012] handles unsorted and overlapping busy intervals', () => {
    const busy = [
      { start: '11:00', end: '12:00' },
      { start: '09:00', end: '11:30' },
    ];
    expect(nextFreeSlot('08:00', 60, busy, '22:00')).toBe('08:00');
    expect(nextFreeSlot('09:00', 60, busy, '22:00')).toBe('12:00');
  });

  it('[F-010] returns null when the block does not fit before the day end', () => {
    expect(nextFreeSlot('21:30', 40, [], '22:00')).toBeNull();
    expect(nextFreeSlot('21:20', 40, [], '22:00')).toBe('21:20');
    expect(nextFreeSlot('20:00', 60, [{ start: '20:30', end: '22:00' }], '22:00')).toBeNull();
  });

  it('[F-009] treats a zero or tiny duration as one grid cell', () => {
    expect(nextFreeSlot('09:00', 0, [{ start: '09:00', end: '09:05' }], '22:00')).toBe('09:05');
  });
});
