import { useEffect, useRef, useState } from 'react';
import type { Item } from '../../domain/types';
import type { InlineKind } from '../focus';
import { blockRange, dateLabel, fmtMin, parseHHMM, parseRescheduleInput } from '../format';
import { paddedOf, useStore } from '../store';
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
  edit: 'title',
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
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="inline-editor"
      data-testid={T.inlineEditor}
      data-kind={kind}
      value={value}
      placeholder={INLINE_PLACEHOLDER[kind]}
      aria-label={`inline ${kind}`}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          // unchanged text is a cancel, so a title rewritten by the model meanwhile is not overwritten
          if (value.trim() === initial.trim()) onCancel();
          else onSave(value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
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
      case 'edit':
        if (value && value !== item.title) void patch(item.id, { title: value });
        return;
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
        return item.title;
      case 'reschedule':
        return '';
      case 'block':
        return item.block?.start ?? '';
      case 'cue':
        return item.cue ?? '';
    }
  };

  const mark = isDone ? '✓' : isSkipped ? '–' : item.startedAt ? '▶' : '·';

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
      {!isDone && item.repeat === undefined && (
        <button
          type="button"
          className="remove"
          data-testid={T.rowRemove}
          aria-label={`remove "${item.title}"`}
          title="remove from the list (d)"
          onMouseDown={(e) => e.preventDefault()} // keep the capture bar focused
          onClick={(e) => {
            e.stopPropagation();
            showToast(`removed "${item.title}"`);
            void rowAction(item.id, 'drop');
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
    </li>
  );
}
