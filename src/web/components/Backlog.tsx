import { useStore, visibleRows } from '../store';
import { T } from '../testids';
import { Row } from './Row';

export function Backlog() {
  const state = useStore((s) => s.state);
  const filter = useStore((s) => s.filter);
  if (!state) return null;
  const all = state.derived.backlog;
  const shown = filter
    ? visibleRows(state, 'backlog', filter).filter((it) => all.includes(it))
    : all;
  return (
    <section data-testid={T.backlog}>
      <h2>
        backlog · {shown.length}
        {filter && <span className="chip">filter: {filter}</span>}
      </h2>
      {shown.length === 0 && (
        <p className="empty">{filter ? 'nothing matches' : 'backlog is empty'}</p>
      )}
      <ul className="rows">
        {shown.map((item) => (
          <Row key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}
