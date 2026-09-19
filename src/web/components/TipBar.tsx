import { useEffect, useState } from 'react';
import { T } from '../testids';
import tipsJson from '../tips.json';

export type TipGroup = 'planning' | 'capacity' | 'slip' | 'habit' | 'review';

export interface Tip {
  text: string;
  practice: string;
  source: string;
  group: TipGroup;
}

export const TIPS: Tip[] = tipsJson as Tip[];

export const ROTATE_MS = 10 * 60 * 1000;

interface Props {
  /** Context decides the group: slips → 'slip', overCap → 'capacity', else 'planning'. */
  context: { slips: number; overCap: boolean };
  tips?: Tip[];
}

export function groupFor(context: Props['context']): TipGroup {
  if (context.slips > 0) return 'slip';
  if (context.overCap) return 'capacity';
  return 'planning';
}

/** Rotates every 10 min; the source is visible on hover or when expanded (F-021). */
export function TipBar({ context, tips = TIPS }: Props) {
  const [tick, setTick] = useState(0);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ROTATE_MS);
    return () => clearInterval(id);
  }, []);
  const group = groupFor(context);
  const pool = tips.filter((t) => t.group === group);
  const list = pool.length > 0 ? pool : tips;
  if (list.length === 0) return null;
  const tip = list[tick % list.length];
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: expanding the source is a mouse convenience; the source is also in the title
    // biome-ignore lint/a11y/noStaticElementInteractions: see above
    <div
      className={`tipbar ${expanded ? 'expanded' : ''}`}
      data-testid={T.tipBar}
      data-group={group}
      title={tip.source}
      onClick={() => setExpanded((e) => !e)}
    >
      <span data-testid={T.tipText}>{tip.text}</span>{' '}
      <span className="practice" data-testid={T.tipPractice}>
        — {tip.practice}
      </span>
      <span className="source" data-testid={T.tipSource}>
        {tip.source}
      </span>
    </div>
  );
}
