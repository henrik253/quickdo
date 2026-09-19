import { dateLabel } from '../format';
import { useStore, visibleRows } from '../store';
import { T } from '../testids';
import { Row } from './Row';

export function Upcoming() {
  const state = useStore((s) => s.state);
  const filter = useStore((s) => s.filter);
  if (!state) return null;
  const today = state.derived.date;
  const visible = new Set(visibleRows(state, 'upcoming', filter).map((it) => it.id));
  const groups = state.derived.upcoming
    .map((g) => ({ date: g.date, items: g.items.filter((it) => visible.has(it.id)) }))
    .filter((g) => g.items.length > 0);
  return (
    <section data-testid={T.upcoming}>
      <h2>
        upcoming
        {filter && <span className="chip">filter: {filter}</span>}
        <span className="chip">
          <kbd>p</kbd> backlog
        </span>
      </h2>
      {groups.length === 0 && <p className="empty">nothing scheduled ahead</p>}
      {groups.map((g) => (
        <div key={g.date} data-testid={T.upcomingGroup} data-date={g.date}>
          <div className="group-title">{dateLabel(g.date, today)}</div>
          <ul className="rows">
            {g.items.map((item) => (
              <Row key={item.id} item={item} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
