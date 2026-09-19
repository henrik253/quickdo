import { useStore } from '../store';
import { T } from '../testids';
import { Row } from './Row';

export function TodayList() {
  const state = useStore((s) => s.state);
  const clearDone = useStore((s) => s.clearDone);
  if (!state) return null;
  const { derived, rolloverCount } = state;
  const n = derived.today.length;
  const slipOf = (id: string) => derived.slips.find((s) => s.id === id)?.kind;

  return (
    <section>
      <h2
        className={derived.overCap ? 'amber' : ''}
        data-testid={T.todayHeader}
        data-overcap={derived.overCap}
      >
        {derived.overCap ? (
          <span>
            {n} on Today — move one to tomorrow? (<kbd>T</kbd>)
          </span>
        ) : (
          <span>Today · {n}</span>
        )}
        {rolloverCount > 0 && (
          <span className="chip" data-testid={T.rolloverChip}>
            {rolloverCount} from yesterday moved to backlog (t = today)
          </span>
        )}
      </h2>
      {n === 0 && derived.doneToday.length === 0 && (
        <p className="empty">
          Nothing on Today yet — <kbd>⌘Enter</kbd> or <code>!today</code> puts something here,{' '}
          <kbd>t</kbd> moves a backlog row up.
        </p>
      )}
      <ul className="rows" data-testid={T.todayList}>
        {derived.today.map((item) => (
          <Row key={item.id} item={item} slip={slipOf(item.id)} testId={T.todayRow} />
        ))}
      </ul>
      {derived.doneToday.length > 0 && (
        <>
          <h2 style={{ marginTop: 10 }}>
            <span>done · {derived.doneToday.length}</span>
            <button
              type="button"
              className="link-button"
              data-testid={T.clearDone}
              title="move every done item out of the list; the tracker keeps counting them"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void clearDone()}
            >
              clear done
            </button>
          </h2>
          <ul className="rows" data-testid={T.doneSection}>
            {derived.doneToday.map((item) => (
              <Row key={item.id} item={item} testId={T.todayRow} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
