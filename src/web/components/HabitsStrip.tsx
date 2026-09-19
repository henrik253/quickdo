import { useStore } from '../store';
import { T } from '../testids';
import { Row } from './Row';

export const NEVER_MISS_TWICE = 'one miss is fine — do the 2-minute version today';

export function HabitsStrip() {
  const state = useStore((s) => s.state);
  if (!state || state.derived.habits.length === 0) return null;
  const habits = state.derived.habits;
  return (
    <section data-testid={T.habitsStrip}>
      <h2>
        habits · {state.derived.progress.habitsDone} of {state.derived.progress.habitsDue} today
      </h2>
      <ul className="rows">
        {habits.map((h) => (
          <Row
            key={h.item.id}
            item={h.item}
            testId={T.habitRow}
            pinnedCopy={h.missedYesterday && !h.doneToday ? NEVER_MISS_TWICE : undefined}
            extra={
              <>
                <span className="chip" data-testid={T.rowChip} data-kind="consistency">
                  {h.done7} of last {h.due7}
                </span>
                {h.doneToday && (
                  <span className="chip accent" data-testid={T.rowChip} data-kind="done-today">
                    done today
                  </span>
                )}
                {!h.dueToday && (
                  <span className="chip" data-testid={T.rowChip} data-kind="not-due">
                    not due today
                  </span>
                )}
              </>
            }
          />
        ))}
      </ul>
    </section>
  );
}
