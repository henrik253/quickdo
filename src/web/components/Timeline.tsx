import { useEffect, useState } from 'react';
import { hhmmToMin, minToHHMM } from '../../domain/time';
import type { Derived, Schedule } from '../../domain/types';
import { fmtMin } from '../format';
import { T } from '../testids';

interface Props {
  derived: Derived;
  schedule: Schedule;
  /** Force a layout (tests); otherwise `(min-width: 900px)` decides. */
  layout?: 'column' | 'strip';
}

export function useWide(query = '(min-width: 900px)'): boolean {
  const [wide, setWide] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : true,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return wide;
}

export function capacityText(c: Derived['capacity']): string {
  if (c.remainingMin >= 0) return `${fmtMin(c.remainingMin)} free after slack`;
  return `over by ${fmtMin(-c.remainingMin)} — move one to tomorrow?`;
}

export function CapacityMeter({ capacity }: { capacity: Derived['capacity'] }) {
  const pct = Math.min(100, Math.round(capacity.ratio * 100));
  return (
    <div
      className={`capacity ${capacity.level}`}
      data-testid={T.capacityMeter}
      data-level={capacity.level}
    >
      <div className="meter" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="text">{capacityText(capacity)}</div>
    </div>
  );
}

/** Vertical day column on wide windows, compact strip on narrow ones (F-009, F-010, F-012). */
export function Timeline({ derived, schedule, layout }: Props) {
  const wide = useWide();
  const mode = layout ?? (wide ? 'column' : 'strip');
  const startMin = hhmmToMin(schedule.dayStart);
  const endMin = hhmmToMin(schedule.dayEnd);
  const span = Math.max(1, endMin - startMin);
  const pct = (hhmm: string) => ((hhmmToMin(hhmm) - startMin) / span) * 100;
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const nowPct = clamp(pct(derived.now));
  const slackStart = clamp(((endMin - schedule.slackMinutes - startMin) / span) * 100);

  if (mode === 'strip') {
    return (
      <div>
        <CapacityMeter capacity={derived.capacity} />
        <div className="timeline-strip" data-testid={T.timelineStrip}>
          <div
            className="slack"
            data-testid={T.slackBand}
            style={{ left: `${slackStart}%`, right: 0 }}
          />
          {derived.busy.map((b) => (
            <div
              key={`${b.kind}:${b.start}:${b.end}:${b.label}`}
              className={`busy ${b.kind}`}
              data-testid={T.timelineBusy}
              data-kind={b.kind}
              title={`${b.label} ${b.start}–${b.end}`}
              style={{
                left: `${clamp(pct(b.start))}%`,
                width: `${clamp(pct(b.end)) - clamp(pct(b.start))}%`,
              }}
            >
              {b.label}
            </div>
          ))}
          <div className="now-line" data-testid={T.nowLine} style={{ left: `${nowPct}%` }} />
        </div>
      </div>
    );
  }

  const hours: number[] = [];
  for (let m = Math.ceil(startMin / 60) * 60; m <= endMin; m += 60) hours.push(m);

  return (
    <div>
      <CapacityMeter capacity={derived.capacity} />
      <div className="timeline" data-testid={T.timeline}>
        {hours.map((m) => (
          <div key={m} className="hour" style={{ top: `${((m - startMin) / span) * 100}%` }}>
            {minToHHMM(m)}
          </div>
        ))}
        <div
          className="slack"
          data-testid={T.slackBand}
          title={`slack ${fmtMin(schedule.slackMinutes)}`}
          style={{ top: `${slackStart}%`, bottom: 0 }}
        />
        {derived.busy.map((b) => (
          <div
            key={`${b.kind}:${b.start}:${b.end}:${b.label}`}
            className={`busy ${b.kind}`}
            data-testid={T.timelineBusy}
            data-kind={b.kind}
            title={`${b.label} ${b.start}–${b.end}`}
            style={{
              top: `${clamp(pct(b.start))}%`,
              height: `${Math.max(1.5, clamp(pct(b.end)) - clamp(pct(b.start)))}%`,
            }}
          >
            {b.start} {b.label}
          </div>
        ))}
        <div
          className="now-line"
          data-testid={T.nowLine}
          style={{ top: `${nowPct}%` }}
          title={`now ${derived.now}`}
        />
      </div>
    </div>
  );
}
