import { useEffect, useMemo, useRef } from 'react';
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
  const inputRef = useRef<HTMLInputElement>(null);

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

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
        if (parsed?.filter !== undefined) return; // a filter, not a capture
        void capture(draft, action.target).then(() => inputRef.current?.focus());
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
      <input
        ref={inputRef}
        data-testid={T.captureInput}
        type="text"
        value={draft}
        placeholder="Add a todo…  !today  @9  ~30m  #project  when …   (? filters)"
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
