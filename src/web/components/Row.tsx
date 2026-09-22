import { useEffect, useRef, useState } from 'react';
import { editPatchFromText, itemToText } from '../../domain/capture/serialize';
import { newId } from '../../domain/state/reducer';
import { diffDays } from '../../domain/time';
import { DEFAULT_SETTINGS, type Item } from '../../domain/types';
import type { InlineKind } from '../focus';
import { blockRange, dateLabel, fmtMin, parseHHMM, parseRescheduleInput } from '../format';
import { clockOf, paddedOf, useStore } from '../store';
import { T } from '../testids';
import { SlipBanner, type SlipKind } from './SlipBanner';

interface Props {
  item: Item;
  slip?: SlipKind;
  pinnedCopy?: string;
  /** Extra chips rendered after the standard ones (e.g. the habit consistency). */
  extra?: React.ReactNode;
  testId?: string;
}

const INLINE_PLACEHOLDER: Record<InlineKind, string> = {
  edit: 'title  #project  +tag  ~30m  due …  when …\nnotes\n- sub-todo   [x] done sub-todo',
  reschedule: 'mon · +2 · tomorrow · backlog · 2026-09-30',
  block: 'HH:MM',
  cue: 'when I … (if-then cue)',
};

function InlineEditor({
  kind,
  initial,
  onSave,
  onCancel,
}: {
  kind: InlineKind;
  initial: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    if (kind !== 'edit') ref.current?.select();
  }, [kind]);
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.stopPropagation();
    // the full editor is multi-line: Enter = new line, Shift+Enter saves; the one-line editors save on Enter
    const saves = e.key === 'Enter' && (kind !== 'edit' || e.shiftKey || e.metaKey || e.ctrlKey);
    if (saves) {
      e.preventDefault();
      // unchanged text is a cancel, so a title rewritten by the model meanwhile is not overwritten
      if (value.trim() === initial.trim()) onCancel();
      else onSave(value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };
  if (kind === 'edit') {
    return (
      <textarea
        ref={ref as React.RefObject<HTMLTextAreaElement>}
        className="inline-editor multiline"
        data-testid={T.inlineEditor}
        data-kind={kind}
        value={value}
        rows={Math.min(12, Math.max(2, value.split('\n').length + 1))}
        placeholder={INLINE_PLACEHOLDER[kind]}
        aria-label="edit todo"
        title="Shift+Enter saves · Esc cancels"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onCancel}
      />
    );
  }
  return (
    <input
      ref={ref as React.RefObject<HTMLInputElement>}
      className="inline-editor"
      data-testid={T.inlineEditor}
      data-kind={kind}
      value={value}
      placeholder={INLINE_PLACEHOLDER[kind]}
      aria-label={`inline ${kind}`}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onCancel}
    />
  );
}

export function Row({ item, slip, pinnedCopy, extra, testId }: Props) {
  const state = useStore((s) => s.state);
  const cursor = useStore((s) => s.cursor);
  const flash = useStore((s) => s.flash);
  const inline = useStore((s) => s.inline);
  const setCursor = useStore((s) => s.setCursor);
  const setMode = useStore((s) => s.setMode);
  const setInline = useStore((s) => s.setInline);
  const rowAction = useStore((s) => s.rowAction);
  const patch = useStore((s) => s.patch);
  const showToast = useStore((s) => s.showToast);
  const expanded = useStore((s) => s.expanded);
  const unfoldAll = useStore((s) => s.unfoldAll);
  const toggleExpanded = useStore((s) => s.toggleExpanded);
  const toggleSubtask = useStore((s) => s.toggleSubtask);

  if (!state) return null;
  const today = state.derived.date;
  const isCursor = cursor === item.id;
  const inlineHere = inline && inline.id === item.id ? inline : null;
  const paddedMin = paddedOf(state, item);
  const isDone = item.status === 'done';
  const isSkipped = item.status === 'skipped';
  const classes = ['row'];
  if (isCursor) classes.push('cursor');
  if (flash.includes(item.id)) classes.push('flash');
  if (isDone) classes.push('done');
  if (isSkipped) classes.push('skipped');
  if (pinnedCopy) classes.push('pinned');

  const closeInline = () => {
    setInline(null);
  };

  const saveInline = (kind: InlineKind, raw: string) => {
    const value = raw.trim();
    closeInline();
    switch (kind) {
      case 'edit': {
        const clock = clockOf(state, useStore.getState().receivedAt);
        const p = editPatchFromText(item, raw, clock, state.settings ?? DEFAULT_SETTINGS, () =>
          newId(clock),
        );
        if (!p) {
          showToast('a todo needs a title', 'warn');
          return;
        }
        if (Object.keys(p).length > 0) void patch(item.id, p);
        return;
      }
      case 'reschedule': {
        const to = parseRescheduleInput(value, today);
        if (to === undefined) {
          showToast(`could not read "${value}" — try mon, +2, tomorrow or backlog`, 'warn');
          return;
        }
        if (to === null) void rowAction(item.id, 'backlog');
        else if (to === today) void rowAction(item.id, 'today');
        else if (to === parseRescheduleInput('tomorrow', today))
          void rowAction(item.id, 'tomorrow');
        else void patch(item.id, { scheduledFor: to });
        return;
      }
      case 'block': {
        const start = parseHHMM(value);
        if (!start) {
          showToast(`"${value}" is not a time — use HH:MM`, 'warn');
          return;
        }
        void patch(item.id, { block: { start, minutes: item.block?.minutes ?? paddedMin } });
        return;
      }
      case 'cue':
        if (value) void patch(item.id, { cue: value });
        return;
    }
  };

  const initialFor = (kind: InlineKind): string => {
    switch (kind) {
      case 'edit':
        return itemToText(item);
      case 'reschedule':
        return '';
      case 'block':
        return item.block?.start ?? '';
      case 'cue':
        return item.cue ?? '';
    }
  };

  const mark = isDone ? '✓' : isSkipped ? '–' : item.startedAt ? '▶' : '·';
  const subtasks = item.subtasks ?? [];
  const hasDetails = subtasks.length > 0 || Boolean(item.note);
  const isOpen = hasDetails && (expanded[item.id] ?? unfoldAll);
  const subDone = subtasks.filter((st) => st.done).length;
  const ongoingDay = item.ongoingSince ? Math.max(1, diffDays(item.ongoingSince, today) + 1) : 1;
  const subOpen = subtasks.length - subDone;
  const canFinish = isDone || subOpen === 0;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handling is global (list mode); the click only moves the cursor
    <li
      className={classes.join(' ')}
      data-testid={testId ?? T.row}
      data-id={item.id}
      data-status={item.status}
      aria-current={isCursor ? 'true' : undefined}
      onClick={() => {
        setCursor(item.id);
        setMode('list');
      }}
    >
      <input
        type="checkbox"
        className="tick"
        data-testid={T.rowTick}
        checked={isDone}
        disabled={!canFinish}
        aria-label={isDone ? `undo "${item.title}"` : `finish "${item.title}"`}
        title={
          canFinish
            ? isDone
              ? 'done — untick to reopen (u)'
              : 'finish (x)'
            : `${subOpen} sub-todo${subOpen === 1 ? '' : 's'} still open — tick them first`
        }
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
        onChange={() => void rowAction(item.id, isDone ? 'undo' : 'done')}
      />
      <span className="mark" aria-hidden="true">
        {mark}
      </span>
      {inlineHere ? (
        <InlineEditor
          key={inlineHere.kind}
          kind={inlineHere.kind}
          initial={initialFor(inlineHere.kind)}
          onSave={(v) => saveInline(inlineHere.kind, v)}
          onCancel={closeInline}
        />
      ) : (
        <span className="title" data-testid={T.rowTitle}>
          {item.title}
        </span>
      )}
      <span className="chips">
        {item.block && (
          <span className="chip accent" data-testid={T.rowChip} data-kind="block">
            {blockRange(item.block)}
          </span>
        )}
        {!isDone && item.repeat === undefined && (
          <span
            className="chip"
            data-testid={T.rowChip}
            data-kind="estimate"
            title="padded estimate"
          >
            {fmtMin(paddedMin)}
          </span>
        )}
        {(item.estimateMin ?? 0) > 90 && !isDone && (
          <span className="chip amber" data-testid={T.rowChip} data-kind="split">
            split?
          </span>
        )}
        {item.project && (
          <span className="chip" data-testid={T.rowChip} data-kind="project">
            #{item.project}
          </span>
        )}
        {item.cue && (
          <span className="chip" data-testid={T.rowChip} data-kind="cue">
            when: {item.cue}
          </span>
        )}
        {item.due && (
          <span className="chip" data-testid={T.rowChip} data-kind="due">
            due {dateLabel(item.due, today)}
          </span>
        )}
        {item.scheduledFor && item.scheduledFor !== today && (
          <span className="chip" data-testid={T.rowChip} data-kind="scheduled">
            {dateLabel(item.scheduledFor, today)}
          </span>
        )}
        {item.suggestedFor && (
          <span className="chip amber" data-testid={T.rowChip} data-kind="suggested">
            suggested {dateLabel(item.suggestedFor, today)} · a
          </span>
        )}
        {item.checkpoint && !isDone && (
          <span className="chip" data-testid={T.rowChip} data-kind="checkpoint">
            checkpoint {item.checkpoint}
          </span>
        )}
        {item.rescheduleCount >= 3 && !isDone && (
          <span className="chip amber" data-testid={T.rowChip} data-kind="rescheduled">
            moved {item.rescheduleCount}×
          </span>
        )}
        {item.ongoing && !isDone && (
          <span
            className="chip accent"
            data-testid={T.rowChip}
            data-kind="ongoing"
            title={`ongoing since ${item.ongoingSince ?? '?'} — stays on Today until you finish it`}
          >
            ongoing · day {ongoingDay}
          </span>
        )}
        {subtasks.length > 0 && (
          <span
            className="chip"
            data-testid={T.rowChip}
            data-kind="subtasks"
            title="sub-todos done"
          >
            {subDone}/{subtasks.length}
          </span>
        )}
        {item.llm?.status === 'pending' && (
          <span
            className="chip llm"
            data-testid={T.rowChip}
            data-kind="llm"
            title="a model is tidying this item"
          >
            ✨ formatting…
          </span>
        )}
        {item.source.kind === 'agent' && (
          <span className="chip" data-testid={T.rowChip} data-kind="agent">
            {item.source.ref ? (
              <a href={item.source.ref} target="_blank" rel="noreferrer">
                {item.source.by ?? 'agent'} ↗
              </a>
            ) : (
              (item.source.by ?? 'agent')
            )}
          </span>
        )}
        {extra}
      </span>
      {!isDone && (
        <button
          type="button"
          className="edit"
          data-testid={T.rowEdit}
          aria-label={`edit "${item.title}"`}
          title="edit title, tags, notes and sub-todos (e)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            setCursor(item.id);
            setMode('list');
            setInline({ id: item.id, kind: 'edit' });
          }}
        >
          ✎
        </button>
      )}
      {hasDetails && (
        <button
          type="button"
          className="fold"
          data-testid={T.rowFold}
          aria-expanded={isOpen}
          aria-label={isOpen ? 'fold details' : 'unfold notes and sub-todos'}
          title="notes and sub-todos (Space)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            toggleExpanded(item.id);
          }}
        >
          {isOpen ? '▾' : '▸'}
        </button>
      )}
      {item.repeat === undefined && (
        <button
          type="button"
          className="remove"
          data-testid={T.rowRemove}
          data-action={isDone ? 'archive' : 'drop'}
          aria-label={isDone ? `clear "${item.title}" from the list` : `remove "${item.title}"`}
          title={
            isDone ? 'clear from the list (stays in the done tracker)' : 'remove from the list (d)'
          }
          onMouseDown={(e) => e.preventDefault()} // keep the capture bar focused
          onClick={(e) => {
            e.stopPropagation();
            showToast(isDone ? `cleared "${item.title}"` : `removed "${item.title}"`);
            void rowAction(item.id, isDone ? 'archive' : 'drop');
          }}
        >
          ✕
        </button>
      )}
      {pinnedCopy && (
        <span className="pinned-copy" data-testid={T.habitPinned}>
          {pinnedCopy}
        </span>
      )}
      {slip && <SlipBanner kind={slip} onAction={(a) => void rowAction(item.id, a)} />}
      {isOpen && (
        <div className="details" data-testid={T.rowDetails}>
          {item.note && (
            <p className="note" data-testid={T.rowNote}>
              {item.note}
            </p>
          )}
          {subtasks.length > 0 && (
            <ul className="subtasks">
              {subtasks.map((st) => (
                <li key={st.id} data-testid={T.rowSubtask} data-done={st.done}>
                  <label>
                    <input
                      type="checkbox"
                      checked={st.done}
                      onMouseDown={(e) => e.preventDefault()}
                      onChange={() => void toggleSubtask(item.id, st.id)}
                    />
                    <span className={st.done ? 'done' : ''}>{st.title}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
