/**
 * Round trip between an item and the capture syntax, so a todo can be edited afterwards in the same
 * form it was typed in: a heading line (title + tokens), the note lines, and one `- ` / `[x] ` line
 * per sub-todo (F-036).
 */
import type { Clock, EditablePatch, Item, Settings, Subtask } from '../types';
import { parseCapture } from './parseCapture';

/** The heading line: title first, then the tokens that describe the item. */
export function itemHeading(item: Item): string {
  const parts = [item.title];
  if (item.project) parts.push(`#${item.project}`);
  for (const t of item.tags) parts.push(`+${t}`);
  if (item.estimateMin !== undefined) parts.push(`~${item.estimateMin}m`);
  if (item.due) parts.push(`due ${item.due}`);
  if (item.cue) parts.push(`when ${item.cue}`);
  if (item.ongoing) parts.push('!ongoing');
  return parts.join(' ');
}

/** The full editable text of an item. */
export function itemToText(item: Item): string {
  const lines = [itemHeading(item)];
  if (item.note) lines.push(...item.note.split('\n'));
  for (const st of item.subtasks ?? []) lines.push(`${st.done ? '[x]' : '-'} ${st.title}`);
  return lines.join('\n');
}

function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * The patch that turns `item` into what `text` describes. Only changed fields are included; a token
 * removed from the heading clears that field. Sub-todos keep their id (and their done state when the
 * line has no explicit `[x]`/`- ` change) by matching titles; new lines get fresh ids from `newId`.
 * Returns null when the text has no title.
 */
export function editPatchFromText(
  item: Item,
  text: string,
  clock: Clock,
  settings: Settings,
  newId: () => string,
): EditablePatch | null {
  const parsed = parseCapture(text, clock, settings);
  if (parsed.filter !== undefined || parsed.title.trim() === '') return null;
  const patch: EditablePatch = {};
  if (parsed.title !== item.title) patch.title = parsed.title;
  const note = parsed.note ?? undefined;
  if ((note ?? '') !== (item.note ?? '')) patch.note = note;
  if ((parsed.project ?? '') !== (item.project ?? '')) patch.project = parsed.project;
  if (!sameStringArray(parsed.tags, item.tags)) patch.tags = parsed.tags;
  if (parsed.estimateMin !== item.estimateMin) patch.estimateMin = parsed.estimateMin;
  if ((parsed.due ?? '') !== (item.due ?? '')) patch.due = parsed.due;
  if ((parsed.cue ?? '') !== (item.cue ?? '')) patch.cue = parsed.cue;
  // a `!day` token in the heading moves the item; without one the day is left alone
  const dayToken = parsed.tokens.some(
    (t) => t.kind === 'schedule' || t.kind === 'slot' || t.kind === 'block',
  );
  if (dayToken && parsed.scheduledFor !== undefined && parsed.scheduledFor !== item.scheduledFor) {
    patch.scheduledFor = parsed.scheduledFor;
  }
  if (parsed.block && JSON.stringify(parsed.block) !== JSON.stringify(item.block))
    patch.block = parsed.block;
  if (parsed.repeat !== undefined && parsed.repeat !== item.repeat) patch.repeat = parsed.repeat;
  if (Boolean(parsed.ongoing) !== Boolean(item.ongoing))
    patch.ongoing = parsed.ongoing ? true : undefined;

  const before = item.subtasks ?? [];
  const pool = [...before];
  const next: Subtask[] = (parsed.subtasks ?? []).map((st) => {
    const i = pool.findIndex((old) => old.title === st.title);
    if (i !== -1) {
      const old = pool.splice(i, 1)[0];
      return { ...old, done: st.done || old.done };
    }
    return { id: newId(), title: st.title, done: st.done };
  });
  if (JSON.stringify(next) !== JSON.stringify(before)) {
    patch.subtasks = next.length > 0 ? next : undefined;
  }
  return patch;
}
