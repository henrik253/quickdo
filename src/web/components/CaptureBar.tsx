import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { parseCapture } from '../../domain/capture/parseCapture';
import { padded } from '../../domain/time';
import { DEFAULT_SETTINGS, type ParsedCapture, type Token } from '../../domain/types';
import { mapKey } from '../focus';
import { dateLabel, fmtMin } from '../format';
import { clockOf, useStore } from '../store';
import { T } from '../testids';

/** Tiny stoplist: a title starting with one of these probably lacks a verb. Never blocks. */
const NOUN_START = new Set([
  'paper',
  'meeting',
  'email',
  'mail',
  'lecture',
  'thesis',
  'report',
  'notes',
  'slides',
  'exercise',
  'homework',
  'draft',
]);

function chipLabel(token: Token, today: string, paddingSettings: typeof DEFAULT_SETTINGS): string {
  switch (token.kind) {
    case 'schedule':
      return /^\d{4}-\d{2}-\d{2}$/.test(token.value)
        ? capitalize(dateLabel(token.value, today))
        : capitalize(token.value);
    case 'block':
      return token.value;
    case 'estimate':
      return `${fmtMin(padded(Number(token.value), paddingSettings))} padded`;
    case 'project':
      return `#${token.value}`;
    case 'tag':
      return `+${token.value}`;
    case 'cue':
      return `when: ${token.value}`;
    case 'fallback':
      return `fallback: ${token.value}`;
    case 'repeat':
      return `repeat: ${token.value}`;
    case 'due':
      return `due ${token.value}`;
    case 'filter':
      return `filter: ${token.value}`;
    case 'slot':
      return 'Today · next free slot';
  }
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function CaptureBar() {
  const draft = useStore((s) => s.draft);
  const mode = useStore((s) => s.mode);
  const state = useStore((s) => s.state);
  const receivedAt = useStore((s) => s.receivedAt);
  const lastCapture = useStore((s) => s.lastCapture);
  const helpOpen = useStore((s) => s.helpOpen);
  const setDraft = useStore((s) => s.setDraft);
  const setMode = useStore((s) => s.setMode);
  const capture = useStore((s) => s.capture);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const settings = state?.settings ?? DEFAULT_SETTINGS;
  const clock = useMemo(
    () => (state ? clockOf(state, receivedAt) : { now: () => new Date(), tz: settings.timezone }),
    [state, receivedAt, settings.timezone],
  );
  const today = state?.derived.date ?? '';

  const parsed: ParsedCapture | null = useMemo(() => {
    if (!draft.trim()) return null;
    try {
      return parseCapture(draft, clock, settings);
    } catch {
      return null;
    }
  }, [draft, clock, settings]);

  // The bar owns focus in capture mode (on mount, after every capture, after `/`).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (mode === 'capture' && !helpOpen) el.focus();
    else if (document.activeElement === el) el.blur();
  }, [mode, helpOpen]);

  // grow with the text (one line for a plain todo, more for notes and sub-todos)
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || draft === undefined) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
  }, [draft]);

  const submit = (target?: 'today') => {
    if (!draft.trim() || parsed?.filter !== undefined) return;
    void capture(draft, target).then(() => inputRef.current?.focus());
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const action = mapKey(
      {
        mode: 'capture',
        pendingChord: null,
        inputEmpty: draft === '',
        helpOpen: false,
        inlineOpen: false,
      },
      { key: e.key, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey },
    );
    switch (action.type) {
      case 'captureSubmit': {
        e.preventDefault();
        submit(action.target);
        return;
      }
      case 'captureClear':
        e.preventDefault();
        setDraft('');
        return;
      case 'enterList':
        e.preventDefault();
        setMode('list');
        return;
      case 'recall':
        e.preventDefault();
        if (lastCapture) setDraft(lastCapture);
        return;
      default:
        return;
    }
  };

  const firstWord = parsed?.title.split(/\s+/)[0]?.toLowerCase() ?? '';
  const verbHint = parsed !== null && parsed.filter === undefined && NOUN_START.has(firstWord);

  return (
    <div className="capture">
      <div className="bar">
        <textarea
          ref={inputRef}
          data-testid={T.captureInput}
          rows={1}
          value={draft}
          placeholder="Add a todo…  !today  @9  ~30m  #project  when …   ↵ new line: notes, - sub-todos · Shift+↵ adds   (? filters)"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Capture"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (mode !== 'capture') setMode('capture');
          }}
        />
        <div className="actions">
          <button
            type="button"
            className="primary"
            data-testid={T.captureSubmit}
            title="add (Shift+Enter)"
            disabled={!draft.trim() || parsed?.filter !== undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => submit()}
          >
            Add
          </button>
          <button
            type="button"
            data-testid={T.captureToday}
            title="add to Today (⌘Enter)"
            disabled={!draft.trim() || parsed?.filter !== undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => submit('today')}
          >
            Today
          </button>
        </div>
      </div>
      <div className="chips" data-testid={T.captureChips} aria-live="polite">
        {parsed?.tokens.map((tk) => (
          <span
            key={`${tk.kind}:${tk.raw}:${tk.value}`}
            className={`chip ${tk.kind === 'filter' ? '' : 'accent'}`}
            data-testid={T.captureChip}
            data-kind={tk.kind}
          >
            {chipLabel(tk, today, settings)}
          </span>
        ))}
        {parsed?.warnings.map((w) => (
          <span key={w} className="chip amber" data-testid={T.captureChip} data-kind="warning">
            {w}
          </span>
        ))}
      </div>
      {verbHint && (
        <div className="hint" data-testid={T.captureHint}>
          start with a verb?
        </div>
      )}
    </div>
  );
}
