import { useEffect, useRef, useState } from 'react';
import { STATS_RANGES } from '../../domain/state/stats';
import type { DoneStats, StatsRange } from '../../domain/types';
import { api } from '../api';
import { useStore } from '../store';
import { T } from '../testids';

const STORAGE_KEY = 'quickdo.doneRange';
const RANGE_LABEL: Record<StatsRange, string> = {
  '3d': '3 days',
  '7d': '7 days',
  '1m': '1 month',
  '3m': '3 months',
};

export function readStoredRange(): StatsRange {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && (STATS_RANGES as readonly string[]).includes(v)) return v as StatsRange;
  } catch {
    /* private mode etc. */
  }
  return '7d';
}

/**
 * The done tracker (F-029): how many items were finished per day (or week) over a chosen range.
 * Reads /api/stats, which counts history events, so cleared/archived items still count.
 */
export function DoneChart() {
  const [range, setRange] = useState<StatsRange>(readStoredRange);
  const [stats, setStats] = useState<DoneStats | null>(null);
  const connected = useStore((s) => s.connected);
  const doneToday = useStore((s) => s.state?.derived.progress.done);
  const itemCount = useStore((s) => s.state?.items.length);
  // anything that can change the counts re-fetches (debounced): a state event, a reconnect
  const refreshKey = `${connected}:${doneToday ?? 0}:${itemCount ?? 0}`;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!refreshKey) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api
        .stats(range)
        .then(setStats)
        .catch(() => {
          /* keep the last chart; the starting banner covers a dead server */
        });
    }, 150);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [range, refreshKey]);

  const choose = (r: StatsRange) => {
    setRange(r);
    try {
      localStorage.setItem(STORAGE_KEY, r);
    } catch {
      /* ignore */
    }
  };

  const best = Math.max(1, stats?.best ?? 0);
  return (
    <section className="done-chart" data-testid={T.doneChart} aria-label="done tracker">
      <div className="head">
        <h2>Done</h2>
        <span className="total" data-testid={T.doneTotal}>
          {stats
            ? `${stats.total} done in the last ${RANGE_LABEL[stats.range]} · ${stats.perDay} per day`
            : 'loading…'}
        </span>
        <fieldset className="ranges" aria-label="range">
          {STATS_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              data-testid={T.doneRange}
              data-range={r}
              aria-pressed={r === range}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(r)}
            >
              {r}
            </button>
          ))}
        </fieldset>
      </div>
      {stats && (
        <>
          <div className="bars">
            {stats.buckets.map((b) => (
              <div
                key={b.start}
                className="bar"
                data-testid={T.doneBucket}
                data-done={b.done}
                title={`${b.done} done ${b.start === b.end ? `on ${b.start}` : `${b.start} – ${b.end}`}`}
              >
                <span className="n">{b.done > 0 ? b.done : ''}</span>
                <div
                  className="fill"
                  style={{ height: `${Math.max(3, (b.done / best) * 100)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="labels">
            {stats.buckets.map((b) => (
              <span key={b.start}>{b.label}</span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
