/**
 * The two-mode focus model (docs/PLAN.md §8) as a pure key → action mapper.
 *
 * Capture mode: the bar is focused; typing, Enter, ⌘Enter, Esc, ↑ (recall), ↓ on an empty bar → list mode.
 * List mode: one row is highlighted; single-letter row keys; `/` or any unbound printable key → capture
 * mode (with the character inserted). Slip-banner actions are the row keys on the slipped row.
 * Ritual mode (`g e`) is a stub in v0.1: Esc leaves it.
 */

export type Mode = 'capture' | 'list' | 'ritual';

export interface KeyInput {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

export interface FocusContext {
  mode: Mode;
  pendingChord: 'g' | null;
  /** The capture bar holds no text. */
  inputEmpty: boolean;
  helpOpen: boolean;
  /** An inline editor (title / reschedule / block / cue) is open on the highlighted row. */
  inlineOpen: boolean;
}

export type RowAction =
  | 'done'
  | 'undo'
  | 'skip'
  | 'today'
  | 'tomorrow'
  | 'backlog'
  | 'next'
  | 'start'
  | 'twoMinute'
  | 'fallback'
  | 'accept'
  | 'drop'
  | 'extend'
  | 'archive';

export type InlineKind = 'edit' | 'reschedule' | 'block' | 'cue';

export type FocusAction =
  | { type: 'none' }
  | { type: 'move'; delta: 1 | -1 }
  | { type: 'row'; action: RowAction }
  | { type: 'inline'; kind: InlineKind }
  | { type: 'shiftBlock'; minutes: 15 | -15 }
  | { type: 'freshStart' }
  | { type: 'toggleView' }
  | { type: 'toggleHelp' }
  | { type: 'closeHelp' }
  | { type: 'chord'; key: 'g' }
  | { type: 'cancelChord' }
  | { type: 'ritual' }
  | { type: 'review' }
  | { type: 'sync' }
  | { type: 'enterCapture'; insert?: string }
  | { type: 'enterList' }
  | { type: 'toggleDetails' }
  | { type: 'captureSubmit'; target?: 'today' }
  | { type: 'captureClear' }
  | { type: 'recall' };

/** Row keys in list mode (single letters; case matters: `t` Today vs `T` tomorrow). */
export const ROW_KEYS: Readonly<Record<string, RowAction>> = {
  x: 'done',
  u: 'undo',
  s: 'skip',
  t: 'today',
  T: 'tomorrow',
  b: 'backlog',
  n: 'next',
  o: 'start',
  '2': 'twoMinute',
  f: 'fallback',
  a: 'accept',
  d: 'drop',
  '+': 'extend',
};

export const INLINE_KEYS: Readonly<Record<string, InlineKind>> = {
  e: 'edit',
  r: 'reschedule',
  '@': 'block',
  c: 'cue',
};

/** Human-readable key map for the `?` overlay. */
export const KEY_HELP: ReadonlyArray<{ keys: string; what: string }> = [
  { keys: '/', what: 'focus the capture bar' },
  { keys: 'Shift+Enter', what: 'add the todo (Enter = new line: notes, - sub-todos)' },
  { keys: '⌘Enter', what: 'add to Today' },
  { keys: '↑', what: 'recall the last capture' },
  { keys: '↓ / Esc', what: 'leave the bar → list mode' },
  { keys: 'j / k', what: 'move down / up' },
  { keys: 'Space', what: 'fold / unfold notes and sub-todos' },
  { keys: 'x / u', what: 'done / undo' },
  { keys: 's', what: 'skip' },
  { keys: 't / T / b', what: 'Today / tomorrow / Backlog' },
  { keys: 'r', what: 'reschedule inline (mon · +2 · backlog)' },
  { keys: 'e', what: 'edit the title inline' },
  { keys: 'c', what: 'set the if-then cue' },
  { keys: '@', what: 'set a block (HH:MM)' },
  { keys: '[ / ]', what: 'shift the block ±15 min' },
  { keys: '+', what: 'extend the block 15 min' },
  { keys: 'n', what: 'move to the next free slot (moves at most one other block)' },
  { keys: 'o', what: 'on it (start)' },
  { keys: '2', what: 'two-minute start' },
  { keys: 'f', what: 'apply the fallback (15 min at 16:00)' },
  { keys: '.', what: 'fresh start' },
  { keys: 'a', what: 'accept the agent suggestion' },
  { keys: 'd', what: 'drop' },
  { keys: 'p', what: 'Backlog ↔ Upcoming' },
  { keys: 'g e / g r / g s', what: 'evening ritual / review / sync now' },
  { keys: '?', what: 'this help' },
];

function isPrintable(ev: KeyInput): boolean {
  return ev.key.length === 1 && !ev.meta && !ev.ctrl && !ev.alt;
}

/** Map a key press to an action given the current focus context. Pure. */
export function mapKey(ctx: FocusContext, ev: KeyInput): FocusAction {
  if (ctx.helpOpen) {
    if (ev.key === 'Escape' || ev.key === '?') return { type: 'closeHelp' };
    return { type: 'none' };
  }
  if (ctx.mode === 'capture') return mapCapture(ctx, ev);
  if (ctx.mode === 'ritual') {
    if (ev.key === 'Escape') return { type: 'enterList' };
    return { type: 'none' };
  }
  return mapList(ctx, ev);
}

function mapCapture(ctx: FocusContext, ev: KeyInput): FocusAction {
  switch (ev.key) {
    case 'Enter':
      // Enter alone inserts a new line (multi-line captures); Shift+Enter submits, ⌘/Ctrl+Enter submits to Today
      if (ev.meta || ev.ctrl) return { type: 'captureSubmit', target: 'today' };
      return ev.shift ? { type: 'captureSubmit' } : { type: 'none' };
    case 'Escape':
      return ctx.inputEmpty ? { type: 'enterList' } : { type: 'captureClear' };
    case 'ArrowDown':
      return ctx.inputEmpty ? { type: 'enterList' } : { type: 'none' };
    case 'ArrowUp':
      return ctx.inputEmpty ? { type: 'recall' } : { type: 'none' };
    default:
      return { type: 'none' };
  }
}

function mapList(ctx: FocusContext, ev: KeyInput): FocusAction {
  if (ctx.inlineOpen) return { type: 'none' };
  if (ctx.pendingChord === 'g') {
    if (ev.key === 'e') return { type: 'ritual' };
    if (ev.key === 'r') return { type: 'review' };
    if (ev.key === 's') return { type: 'sync' };
    return { type: 'cancelChord' };
  }
  if (ev.meta || ev.ctrl || ev.alt) return { type: 'none' };
  switch (ev.key) {
    case 'Escape':
    case '/':
      return { type: 'enterCapture' };
    case 'j':
    case 'ArrowDown':
      return { type: 'move', delta: 1 };
    case 'k':
    case 'ArrowUp':
      return { type: 'move', delta: -1 };
    case '[':
      return { type: 'shiftBlock', minutes: -15 };
    case ']':
      return { type: 'shiftBlock', minutes: 15 };
    case '.':
      return { type: 'freshStart' };
    case 'p':
      return { type: 'toggleView' };
    case 'g':
      return { type: 'chord', key: 'g' };
    case '?':
      return { type: 'toggleHelp' };
    default:
      break;
  }
  if (ev.key === ' ') return { type: 'toggleDetails' };
  const row = ROW_KEYS[ev.key];
  if (row) return { type: 'row', action: row };
  const inline = INLINE_KEYS[ev.key];
  if (inline) return { type: 'inline', kind: inline };
  if (isPrintable(ev) && ev.key !== ' ') return { type: 'enterCapture', insert: ev.key };
  return { type: 'none' };
}

/** The mode after an action; everything not listed keeps the mode. */
export function nextMode(mode: Mode, action: FocusAction): Mode {
  switch (action.type) {
    case 'enterCapture':
    case 'captureSubmit':
      return 'capture';
    case 'enterList':
      return 'list';
    case 'ritual':
      return 'ritual';
    default:
      return mode;
  }
}
