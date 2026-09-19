import { ROW_KEYS, type RowAction } from '../focus';
import { T } from '../testids';

export type SlipKind = 'notStarted' | 'overran';

interface Props {
  kind: SlipKind;
  onAction: (action: RowAction) => void;
}

const NOT_STARTED: Array<[string, RowAction, string]> = [
  ['2', 'twoMinute', 'start'],
  ['o', 'start', 'on it'],
  ['n', 'next', 'next slot'],
  ['f', 'fallback', 'fallback'],
  ['T', 'tomorrow', 'tomorrow'],
  ['s', 'skip', 'skip'],
];

const OVERRAN: Array<[string, RowAction, string]> = [
  ['+', 'extend', '15 min'],
  ['x', 'done', 'done'],
];

/**
 * The slip banner on a Today row (F-013). Its keys are simply the row keys, so there is no third
 * focus target; the buttons exist for the mouse.
 */
export function SlipBanner({ kind, onAction }: Props) {
  const entries = kind === 'notStarted' ? NOT_STARTED : OVERRAN;
  const lead = kind === 'notStarted' ? 'not started — ' : 'still on it? ';
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the banner mirrors the row keys for tests and mouse users
    <div
      className="slip"
      data-testid={T.slipBanner}
      data-kind={kind}
      tabIndex={-1}
      onKeyDown={(e) => {
        const action = ROW_KEYS[e.key];
        if (action) {
          e.preventDefault();
          e.stopPropagation();
          onAction(action);
        }
      }}
    >
      {lead}
      {entries.map(([key, action, label], i) => (
        <span key={key}>
          {i > 0 && ' · '}
          <button type="button" onClick={() => onAction(action)} data-key={key}>
            {key} {label}
          </button>
        </span>
      ))}
    </div>
  );
}
