import type { Derived } from '../../domain/types';
import { T } from '../testids';

interface Props {
  progress: Derived['progress'];
}

export function progressLabel(p: Derived['progress']): string {
  const parts = [`${p.done} done`, `${p.skipped} skipped`, `${p.open} left`];
  if (p.habitsDue > 0) parts.push(`${p.habitsDone} of ${p.habitsDue} habits`);
  return parts.join(' · ');
}

/** One segment per committed Today item: filled done, hatched skipped, empty open (F-008). */
export function ProgressBar({ progress }: Props) {
  return (
    <div className="progress" data-testid={T.progressBar}>
      {progress.segments.length > 0 && (
        <div className="segments">
          {progress.segments.map((seg) => (
            <span
              key={seg.id}
              className={`segment ${seg.status}`}
              data-testid={T.progressSegment}
              data-status={seg.status}
              title={seg.title}
            />
          ))}
        </div>
      )}
      <div className="progress-label" data-testid={T.progressLabel}>
        {progressLabel(progress)}
      </div>
    </div>
  );
}
