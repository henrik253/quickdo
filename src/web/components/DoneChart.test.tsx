import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DoneStats } from '../../domain/types';
import { resetStore } from '../store';
import { T } from '../testids';
import { jsonResponse, makeState, mockFetch, seedStore } from '../testing/webFixtures';
import { DoneChart, readStoredRange } from './DoneChart';

function stats(range: DoneStats['range'], counts: number[]): DoneStats {
  const buckets = counts.map((done, i) => ({
    start: `2026-09-${String(10 + i).padStart(2, '0')}`,
    end: `2026-09-${String(10 + i).padStart(2, '0')}`,
    label: `L${i}`,
    done,
  }));
  const total = counts.reduce((a, b) => a + b, 0);
  return {
    range,
    unit: 'day',
    from: buckets[0].start,
    to: buckets[buckets.length - 1].end,
    buckets,
    total,
    best: Math.max(...counts),
    perDay: Math.round((total / counts.length) * 10) / 10,
  };
}

async function flush() {
  await act(async () => {
    vi.advanceTimersByTime(200);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('DoneChart', () => {
  beforeEach(() => {
    resetStore();
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetStore();
  });

  it('[F-029] renders one bar per bucket with the total, and switching the range refetches and is remembered', async () => {
    const fetchSpy = mockFetch((url) => {
      const u = String(url);
      if (u.includes('range=3d')) return jsonResponse(stats('3d', [1, 0, 2]));
      return jsonResponse(stats('7d', [0, 1, 2, 0, 3, 1, 4]));
    });
    seedStore(makeState([]));
    render(<DoneChart />);
    await flush();
    expect(screen.getAllByTestId(T.doneBucket)).toHaveLength(7);
    expect(screen.getByTestId(T.doneTotal).textContent).toContain('11 done in the last 7 days');
    expect(fetchSpy).toHaveBeenCalledWith('/api/stats?range=7d', expect.anything());

    fireEvent.click(screen.getAllByTestId(T.doneRange).find((b) => b.dataset.range === '3d')!);
    await flush();
    expect(screen.getAllByTestId(T.doneBucket)).toHaveLength(3);
    expect(screen.getByTestId(T.doneTotal).textContent).toContain('3 done in the last 3 days');
    expect(screen.getAllByTestId(T.doneBucket).map((b) => b.dataset.done)).toEqual(['1', '0', '2']);
    expect(readStoredRange()).toBe('3d');
  });

  it('[F-029] starts from the remembered range', async () => {
    localStorage.setItem('quickdo.doneRange', '3m');
    const fetchSpy = mockFetch(() => jsonResponse(stats('3m', [1, 1, 1])));
    seedStore(makeState([]));
    render(<DoneChart />);
    await flush();
    expect(fetchSpy).toHaveBeenCalledWith('/api/stats?range=3m', expect.anything());
    const pressed = screen
      .getAllByTestId(T.doneRange)
      .find((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed?.dataset.range).toBe('3m');
  });
});
