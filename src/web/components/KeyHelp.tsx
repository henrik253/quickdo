import { KEY_HELP } from '../focus';
import { useStore } from '../store';
import { T } from '../testids';

/** The `?` overlay listing the key map. */
export function KeyHelp() {
  const open = useStore((s) => s.helpOpen);
  const setHelpOpen = useStore((s) => s.setHelpOpen);
  if (!open) return null;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc / ? close it via the global key handler
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click closes
    <div className="overlay" data-testid={T.keyHelp} onClick={() => setHelpOpen(false)}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: see above */}
      <div
        className="panel"
        role="dialog"
        aria-label="keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Keys</h3>
        <dl className="keys">
          {KEY_HELP.map((k) => (
            <div key={k.keys} style={{ display: 'contents' }}>
              <dt>{k.keys}</dt>
              <dd>{k.what}</dd>
            </div>
          ))}
        </dl>
        <p className="hint">Esc or ? closes this.</p>
      </div>
    </div>
  );
}
