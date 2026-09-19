/**
 * The single reducer for every state transition (docs/CONTRACTS.md §1, action table).
 * Pure: never mutates its input; a failed precondition returns the input state unchanged plus a warning.
 */
import { monotonicFactory } from 'ulid';
import { blockEnd, busyFor } from '../plan/busy';
import { nextFreeSlot } from '../plan/nextFreeSlot';
import { addDays, hhmmToMin, minToHHMM, nowHHMM, padded, todayISO, toInstant } from '../time';
import type {
  Action,
  CaptureTarget,
  Clock,
  EditablePatch,
  HistoryEvent,
  HistoryType,
  InboxCommand,
  ISODate,
  Item,
  ParsedCapture,
  ReduceResult,
  Settings,
  Source,
  State,
} from '../types';

const nextUlid = monotonicFactory();

/** ULID seeded with the clock's time (monotonic within a millisecond, so ids never collide). */
export function newId(clock: Clock): string {
  return nextUlid(clock.now().getTime());
}

const EDITABLE_KEYS: ReadonlyArray<keyof EditablePatch> = [
  'title',
  'note',
  'cue',
  'fallback',
  'estimateMin',
  'block',
  'due',
  'project',
  'tags',
  'repeat',
  'order',
  'checkpoint',
  'scheduledFor',
  'llm',
];

const INGEST_GUARDED = new Set(['title', 'note', 'cue', 'due', 'estimateMin']);
const REQUIRED_KEYS = new Set<string>(['title', 'tags', 'order']);
const MIN_BLOCK_MINUTES = 5;

interface Ctx {
  state: State; // the working copy — safe to mutate
  clock: Clock;
  settings: Settings;
  now: string;
  today: ISODate;
  events: HistoryEvent[];
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function fail(state: State, warning: string): ReduceResult {
  return { state, events: [], changed: false, warning };
}

function ok(ctx: Ctx, item?: Item): ReduceResult {
  ctx.state.todos.updatedAt = ctx.now;
  return { state: ctx.state, events: ctx.events, changed: true, item };
}

function emit(
  ctx: Ctx,
  type: HistoryType,
  fields: Omit<HistoryEvent, 'ts' | 'type' | 'day'> = {},
): void {
  ctx.events.push({ ts: ctx.now, type, day: ctx.today, ...fields });
}

function touch(ctx: Ctx, item: Item): void {
  item.updatedAt = ctx.now;
}

function find(ctx: Ctx, id: string): Item | undefined {
  return ctx.state.todos.items.find((it) => it.id === id);
}

function isOnToday(ctx: Ctx, item: Item): boolean {
  return item.scheduledFor === ctx.today || item.repeat !== undefined;
}

/** Backlog position: above every current Backlog item. */
function backlogOrder(ctx: Ctx): number {
  const orders = ctx.state.todos.items
    .filter((it) => it.scheduledFor === undefined && it.status === 'open')
    .map((it) => it.order);
  return (orders.length ? Math.min(...orders) : 0) - 1;
}

/** Dated position: below every item on that day. */
function datedOrder(ctx: Ctx, date: ISODate): number {
  const orders = ctx.state.todos.items
    .filter((it) => it.scheduledFor === date)
    .map((it) => it.order);
  return (orders.length ? Math.max(...orders) : 0) + 1;
}

function dayBounds(ctx: Ctx): { dayStart: string; dayEnd: string } {
  return { dayStart: ctx.state.schedule.dayStart, dayEnd: ctx.state.schedule.dayEnd };
}

/** Start of the free window on `date`: now (rounded up to the grid) if today, else the day start. */
function windowStart(ctx: Ctx, date: ISODate): string {
  const { dayStart } = dayBounds(ctx);
  if (date !== ctx.today) return dayStart;
  const nowMin = hhmmToMin(nowHHMM(ctx.clock));
  return nowMin > hhmmToMin(dayStart) ? minToHHMM(Math.ceil(nowMin / 5) * 5) : dayStart;
}

function findSlot(ctx: Ctx, date: ISODate, minutes: number, excludeId?: string): string | null {
  const busy = busyFor(ctx.state, date, { excludeId });
  return nextFreeSlot(windowStart(ctx, date), minutes, busy, dayBounds(ctx).dayEnd);
}

/**
 * After `item.block` changed, push the ONE next block on the same day out of the way if it now
 * overlaps. Never touches anchors, never cascades to a third block.
 */
function resolveOverlap(ctx: Ctx, item: Item): Item | undefined {
  if (!item.block || !item.scheduledFor) return undefined;
  const end = hhmmToMin(blockEnd(item.block));
  const start = hhmmToMin(item.block.start);
  const candidates = ctx.state.todos.items.filter(
    (o) =>
      o.id !== item.id &&
      o.scheduledFor === item.scheduledFor &&
      o.block !== undefined &&
      (o.status === 'open' || o.status === 'skipped') &&
      hhmmToMin(o.block.start) >= start,
  );
  candidates.sort((a, b) => hhmmToMin(a.block!.start) - hhmmToMin(b.block!.start));
  const next = candidates[0];
  if (!next || !next.block) return undefined;
  const nextStart = hhmmToMin(next.block.start);
  if (nextStart >= end) return undefined;
  const from = next.block.start;
  const maxStart = hhmmToMin(dayBounds(ctx).dayEnd) - next.block.minutes;
  next.block.start = minToHHMM(Math.min(end, Math.max(0, maxStart)));
  touch(ctx, next);
  emit(ctx, 'rescheduled', {
    itemId: next.id,
    from,
    to: next.block.start,
    scope: 'next_block_only',
  });
  return next;
}

function setBlockOn(ctx: Ctx, item: Item, start: string, minutes: number): void {
  minutes = Math.max(MIN_BLOCK_MINUTES, minutes);
  item.block = { start, minutes };
  if (minutes >= 60 && item.checkpoint === undefined) {
    const mid = hhmmToMin(start) + minutes / 2;
    item.checkpoint = minToHHMM(Math.round(mid / 5) * 5);
  }
}

function moveToDate(ctx: Ctx, item: Item, to: ISODate | null): void {
  const from = item.scheduledFor;
  if (to === null) {
    const order = backlogOrder(ctx);
    delete item.scheduledFor;
    item.order = order;
  } else {
    const order = datedOrder(ctx, to);
    item.scheduledFor = to;
    item.order = order;
  }
  if (from !== to) delete item.block;
  if (from !== undefined && (to === null || to > from)) item.rescheduleCount += 1;
}

// ---------- actions ----------

function baseItem(ctx: Ctx, title: string, source: Source): Item {
  return {
    id: newId(ctx.clock),
    title,
    status: 'open',
    tags: [],
    rescheduleCount: 0,
    order: 0,
    source,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
}

function add(
  ctx: Ctx,
  parsed: ParsedCapture,
  source: Source,
  target?: CaptureTarget,
): ReduceResult {
  const title = parsed.title.trim();
  if (!title) return fail(ctx.state, 'no title');
  const item = baseItem(ctx, title, source);
  item.tags = [...parsed.tags];
  if (parsed.estimateMin !== undefined) item.estimateMin = parsed.estimateMin;
  if (parsed.project !== undefined) item.project = parsed.project;
  if (parsed.cue !== undefined) item.cue = parsed.cue;
  if (parsed.fallback !== undefined) item.fallback = { ...parsed.fallback };
  if (parsed.repeat !== undefined) item.repeat = parsed.repeat;
  if (parsed.due !== undefined) item.due = parsed.due;

  let scheduledFor = parsed.scheduledFor;
  let wantsSlot = parsed.wantsSlot === true;
  if (scheduledFor === undefined) {
    if (target === 'today') scheduledFor = ctx.today;
    if (target === 'today+slot') {
      scheduledFor = ctx.today;
      wantsSlot = true;
    }
  }
  if (scheduledFor !== undefined) {
    item.scheduledFor = scheduledFor;
    item.order = datedOrder(ctx, scheduledFor);
    if (parsed.block) setBlockOn(ctx, item, parsed.block.start, parsed.block.minutes);
  } else {
    item.order = backlogOrder(ctx);
  }
  let detail: string | undefined;
  if (wantsSlot && item.scheduledFor && !item.block) {
    const minutes = Math.max(MIN_BLOCK_MINUTES, padded(item.estimateMin, ctx.settings));
    const slot = findSlot(ctx, item.scheduledFor, minutes);
    if (slot) setBlockOn(ctx, item, slot, minutes);
    else detail = 'no free slot';
  }
  ctx.state.todos.items.push(item);
  emit(ctx, 'added', { itemId: item.id, to: item.scheduledFor ?? null, by: source.by, detail });
  if (item.block) {
    emit(ctx, 'blocked', { itemId: item.id, to: item.block.start });
    resolveOverlap(ctx, item);
  }
  return ok(ctx, item);
}

function done(ctx: Ctx, id: string, by?: string): ReduceResult {
  const item = find(ctx, id);
  if (!item) return fail(ctx.state, 'not_found');
  if (item.status !== 'open' && item.status !== 'skipped')
    return fail(ctx.state, `already ${item.status}`);
  if (item.repeat === undefined) {
    item.status = 'done';
    item.completedAt = ctx.now;
  }
  delete item.startedAt;
  touch(ctx, item);
  emit(ctx, 'done', { itemId: item.id, by });
  return ok(ctx, item);
}

function undo(ctx: Ctx, id: string): ReduceResult {
  const item = find(ctx, id);
  if (!item) return fail(ctx.state, 'not_found');
  if (item.repeat !== undefined) {
    if (item.status !== 'open' && item.status !== 'skipped' && item.status !== 'done') {
      return fail(ctx.state, `already ${item.status}`);
    }
    item.status = 'open';
    delete item.completedAt;
    delete item.skippedOn;
    touch(ctx, item);
    emit(ctx, 'undone', { itemId: item.id });
    return ok(ctx, item);
  }
  if (item.status !== 'done' && item.status !== 'skipped')
    return fail(ctx.state, `not done: ${item.status}`);
  item.status = 'open';
  delete item.completedAt;
  delete item.skippedOn;
  delete item.startedAt;
  touch(ctx, item);
  emit(ctx, 'undone', { itemId: item.id });
  return ok(ctx, item);
}

function skip(ctx: Ctx, id: string): ReduceResult {
  const item = find(ctx, id);
  if (!item) return fail(ctx.state, 'not_found');
  if (item.status !== 'open') return fail(ctx.state, `already ${item.status}`);
  if (item.repeat === undefined) {
    item.status = 'skipped';
    item.skippedOn = ctx.today;
  }
  delete item.startedAt;
  touch(ctx, item);
  emit(ctx, 'skipped', { itemId: item.id });
  return ok(ctx, item);
}

function drop(ctx: Ctx, id: string): ReduceResult {
  const item = find(ctx, id);
  if (!item) return fail(ctx.state, 'not_found');
  if (item.status === 'done') return fail(ctx.state, 'already done');
  if (item.status === 'dropped') return fail(ctx.state, 'already dropped');
  item.status = 'dropped';
  item.droppedAt = ctx.now;
  delete item.startedAt;
  touch(ctx, item);
  emit(ctx, 'dropped', { itemId: item.id });
  return ok(ctx, item);
}

function start(ctx: Ctx, id: string): ReduceResult {
  const item = find(ctx, id);
  if (!item) return fail(ctx.state, 'not_found');
  if (item.status !== 'open') return fail(ctx.state, `already ${item.status}`);
  if (!isOnToday(ctx, item)) return fail(ctx.state, 'not on Today');
  item.startedAt = ctx.now;
  touch(ctx, item);
  emit(ctx, 'started', { itemId: item.id });
  return ok(ctx, item);
}

function extend(ctx: Ctx, id: string, minutes = 15): ReduceResult {
  const item = find(ctx, id);
  if (!item) return fail(ctx.state, 'not_found');
  if (!item.block) return fail(ctx.state, 'no block');
  const from = String(item.block.minutes);
  item.block = { ...item.block, minutes: item.block.minutes + minutes };
  touch(ctx, item);
  emit(ctx, 'extended', { itemId: item.id, from, to: String(item.block.minutes) });
  resolveOverlap(ctx, item);
  return ok(ctx, item);
}

function reschedule(ctx: Ctx, id: string, to: ISODate | null): ReduceResult {
  const item = find(ctx, id);
  if (!item) return fail(ctx.state, 'not_found');
  if (item.status === 'dropped') return fail(ctx.state, 'gone');
  const from = item.scheduledFor ?? null;
  if (from === to) return fail(ctx.state, to === null ? 'already in Backlog' : `already on ${to}`);
  moveToDate(ctx, item, to);
  touch(ctx, item);
  emit(ctx, 'rescheduled', { itemId: item.id, from, to });
  return ok(ctx, item);
}

function setBlock(ctx: Ctx, id: string, startAt: string, minutes?: number): ReduceResult {
  const item = find(ctx, id);
  if (!item) return fail(ctx.state, 'not_found');
  if (!item.scheduledFor) return fail(ctx.state, 'not scheduled');
  const from = item.block?.start ?? null;
  setBlockOn(ctx, item, startAt, minutes ?? padded(item.estimateMin, ctx.settings));
  touch(ctx, item);
  emit(ctx, 'blocked', { itemId: item.id, from, to: startAt });
  resolveOverlap(ctx, item);
  return ok(ctx, item);
}

function clearBlock(ctx: Ctx, id: string): ReduceResult {
  const item = find(ctx, id);
  if (!item) return fail(ctx.state, 'not_found');
  if (!item.block) return fail(ctx.state, 'no block');
  const from = item.block.start;
  delete item.block;
  touch(ctx, item);
  emit(ctx, 'unblocked', { itemId: item.id, from, to: null });
  return ok(ctx, item);
}

function shiftBlock(ctx: Ctx, id: string, minutes: number): ReduceResult {
  const item = find(ctx, id);
  if (!item) return fail(ctx.state, 'not_found');
  if (!item.block) return fail(ctx.state, 'no block');
  const { dayStart, dayEnd } = dayBounds(ctx);
  const lo = hhmmToMin(dayStart);
  const hi = Math.max(lo, hhmmToMin(dayEnd) - item.block.minutes);
  const target = Math.min(hi, Math.max(lo, hhmmToMin(item.block.start) + minutes));
  const from = item.block.start;
  item.block = { ...item.block, start: minToHHMM(target) };
  touch(ctx, item);
  emit(ctx, 'blocked', { itemId: item.id, from, to: item.block.start });
  return ok(ctx, item);
}

function nextSlot(ctx: Ctx, id: string): ReduceResult {
  const item = find(ctx, id);
  if (!item) return fail(ctx.state, 'not_found');
  if (!item.block && item.scheduledFor !== ctx.today) return fail(ctx.state, 'not on Today');
  const date = item.scheduledFor ?? ctx.today;
  const minutes = Math.max(
    MIN_BLOCK_MINUTES,
    item.block?.minutes ?? padded(item.estimateMin, ctx.settings),
  );
  const slot = findSlot(ctx, date, minutes, item.id);
  if (!slot) return fail(ctx.state, 'no free slot');
  const from = item.block?.start ?? null;
  if (!item.scheduledFor) item.scheduledFor = date;
  item.block = { start: slot, minutes };
  touch(ctx, item);
  emit(ctx, 'rescheduled', { itemId: item.id, from, to: slot, scope: 'next_block_only' });
  resolveOverlap(ctx, item);
  return ok(ctx, item);
}

function applyPatch(
  item: Item,
  patch: EditablePatch,
  keys: ReadonlyArray<keyof EditablePatch>,
): string[] {
  const changed: string[] = [];
  const src = patch as Record<string, unknown>;
  const dst = item as Record<string, unknown>;
  for (const key of keys) {
    if (!Object.hasOwn(src, key)) continue;
    const value = src[key];
    if (value === undefined) {
      if (REQUIRED_KEYS.has(key)) continue; // title/tags/order can never be removed
      if (Object.hasOwn(dst, key)) {
        delete dst[key];
        changed.push(key);
      }
    } else if (JSON.stringify(dst[key]) !== JSON.stringify(value)) {
      dst[key] = clone(value);
      changed.push(key);
    }
  }
  return changed;
}

function edit(ctx: Ctx, id: string, patch: EditablePatch, by?: string): ReduceResult {
  const item = find(ctx, id);
  if (!item) return fail(ctx.state, 'not_found');
  if (item.status === 'dropped') return fail(ctx.state, 'gone');
  const changed = applyPatch(item, patch, EDITABLE_KEYS);
  if (changed.length === 0) return fail(ctx.state, 'nothing to change');
  if (item.title.trim() === '') return fail(ctx.state, 'no title');
  touch(ctx, item);
  emit(ctx, 'edited', { itemId: item.id, by, detail: changed.join(',') });
  return ok(ctx, item);
}

function accept(ctx: Ctx, id: string): ReduceResult {
  const item = find(ctx, id);
  if (!item) return fail(ctx.state, 'not_found');
  if (item.status === 'dropped') return fail(ctx.state, 'gone');
  if (!item.suggestedFor) return fail(ctx.state, 'no suggestion');
  const from = item.scheduledFor ?? null;
  const to = item.suggestedFor;
  delete item.suggestedFor;
  if (from !== to) moveToDate(ctx, item, to);
  touch(ctx, item);
  emit(ctx, 'accepted', { itemId: item.id, from, to });
  return ok(ctx, item);
}

function freshStart(ctx: Ctx): ReduceResult {
  const now = nowHHMM(ctx.clock);
  const nowMin = hhmmToMin(now);
  ctx.state.day.freshStartAt = now;
  let cleared = 0;
  for (const item of ctx.state.todos.items) {
    if (item.scheduledFor !== ctx.today || !item.block) continue;
    if (item.status !== 'open' && item.status !== 'skipped') continue;
    if (hhmmToMin(blockEnd(item.block)) < nowMin) {
      const from = item.block.start;
      delete item.block;
      touch(ctx, item);
      emit(ctx, 'unblocked', { itemId: item.id, from, to: null, reason: 'fresh_start' });
      cleared += 1;
    }
  }
  emit(ctx, 'fresh_start', { detail: String(cleared) });
  return ok(ctx);
}

function rollover(ctx: Ctx): ReduceResult {
  if (ctx.state.day.date === ctx.today) return { state: ctx.state, events: [], changed: false };
  ctx.state.day = { date: ctx.today, freshStartAt: null, eveningRitualDone: false };
  const stale = ctx.state.todos.items
    .filter(
      (it) =>
        it.status === 'open' &&
        it.repeat === undefined &&
        it.scheduledFor !== undefined &&
        it.scheduledFor < ctx.today,
    )
    .sort((a, b) => a.order - b.order);
  for (const item of [...stale].reverse()) {
    const from = item.scheduledFor ?? null;
    moveToDate(ctx, item, null);
    touch(ctx, item);
    emit(ctx, 'rescheduled', { itemId: item.id, from, to: null, reason: 'rollover', auto: true });
  }
  return ok(ctx);
}

function commitEvening(ctx: Ctx, ids: string[], cues: Record<string, string>): ReduceResult {
  const tomorrow = addDays(ctx.today, 1);
  for (const id of ids) {
    const item = find(ctx, id);
    if (!item || item.status === 'dropped' || item.status === 'done') continue;
    const from = item.scheduledFor ?? null;
    if (from !== tomorrow) moveToDate(ctx, item, tomorrow);
    const cue = cues[id];
    if (typeof cue === 'string' && cue.trim() !== '') item.cue = cue.trim();
    touch(ctx, item);
    emit(ctx, 'committed', { itemId: item.id, from, to: tomorrow });
  }
  ctx.state.day.eveningRitualDone = true;
  return ok(ctx);
}

function ingestTarget(
  ctx: Ctx,
  ref: { id?: string; dedupeKey?: string },
): { item: Item } | { warning: string } {
  const item = ctx.state.todos.items.find(
    (it) =>
      (ref.id !== undefined && it.id === ref.id) ||
      (ref.dedupeKey !== undefined && it.source.dedupeKey === ref.dedupeKey),
  );
  if (!item) return { warning: 'not_found' };
  if (item.status === 'dropped') return { warning: 'gone' };
  return { item };
}

function ingest(ctx: Ctx, command: InboxCommand, file: string): ReduceResult {
  switch (command.op) {
    case 'add': {
      const key = command.item.dedupeKey;
      if (key !== undefined && ctx.state.todos.items.some((it) => it.source.dedupeKey === key)) {
        return fail(ctx.state, 'duplicate');
      }
      const title = command.item.title.trim();
      if (!title) return fail(ctx.state, 'no title');
      const source: Source = { kind: 'agent', by: command.by };
      if (command.item.ref !== undefined) source.ref = command.item.ref;
      if (key !== undefined) source.dedupeKey = key;
      const item = baseItem(ctx, title, source);
      const it = command.item;
      if (it.note !== undefined) item.note = it.note;
      if (it.estimateMin !== undefined) item.estimateMin = it.estimateMin;
      if (it.due !== undefined) item.due = it.due;
      if (it.suggestedFor !== undefined) item.suggestedFor = it.suggestedFor;
      if (it.project !== undefined) item.project = it.project;
      if (it.tags !== undefined) item.tags = [...new Set(it.tags)];
      if (it.cue !== undefined) item.cue = it.cue;
      item.order = backlogOrder(ctx);
      ctx.state.todos.items.push(item);
      emit(ctx, 'ingested', { itemId: item.id, by: command.by, to: null, detail: `add:${file}` });
      return ok(ctx, item);
    }
    case 'update': {
      const t = ingestTarget(ctx, command);
      if ('warning' in t) return fail(ctx.state, t.warning);
      const item = t.item;
      const patch = command.patch;
      const guarded = Object.keys(patch).some((k) => INGEST_GUARDED.has(k));
      if (guarded && command.baseUpdatedAt !== item.updatedAt) {
        return fail(ctx.state, `stale: item changed at ${item.updatedAt}`);
      }
      const changed: string[] = [];
      if (patch.tags !== undefined) {
        const merged = [...new Set([...item.tags, ...patch.tags])];
        if (merged.length !== item.tags.length) {
          item.tags = merged;
          changed.push('tags');
        }
      }
      if (patch.ref !== undefined && item.source.ref !== patch.ref) {
        item.source = { ...item.source, ref: patch.ref };
        changed.push('ref');
      }
      const plain: Array<
        'title' | 'note' | 'due' | 'estimateMin' | 'project' | 'cue' | 'suggestedFor'
      > = ['title', 'note', 'due', 'estimateMin', 'project', 'cue', 'suggestedFor'];
      for (const k of plain) {
        const v = patch[k];
        if (v === undefined || item[k] === v) continue;
        if (k === 'title' && String(v).trim() === '') continue;
        (item as Record<string, unknown>)[k] = v;
        changed.push(k);
      }
      if (changed.length === 0) return fail(ctx.state, 'nothing to change');
      touch(ctx, item);
      emit(ctx, 'edited', { itemId: item.id, by: command.by, detail: changed.join(',') });
      return ok(ctx, item);
    }
    case 'done': {
      const t = ingestTarget(ctx, command);
      if ('warning' in t) return fail(ctx.state, t.warning);
      if (command.baseUpdatedAt !== t.item.updatedAt) {
        return fail(ctx.state, `stale: item changed at ${t.item.updatedAt}`);
      }
      return done(ctx, t.item.id, command.by);
    }
    case 'ping': {
      emit(ctx, 'ping', { by: command.by, detail: file });
      return ok(ctx);
    }
  }
}

function archive(ctx: Ctx, ids?: string[]): ReduceResult {
  const wanted = ids ? new Set(ids) : null;
  const archived: Item[] = [];
  const keep: Item[] = [];
  for (const item of ctx.state.todos.items) {
    const chosen = wanted ? wanted.has(item.id) : true;
    if (chosen && item.status === 'done' && item.repeat === undefined) archived.push(item);
    else keep.push(item);
  }
  if (archived.length === 0) return fail(ctx.state, wanted ? 'not done' : 'nothing to archive');
  ctx.state.todos.items = keep;
  for (const item of archived)
    emit(ctx, 'archived', { itemId: item.id, detail: item.title.slice(0, 80) });
  const result = ok(ctx);
  result.archived = archived;
  return result;
}

// ---------- entry point ----------

export function reduce(
  state: State,
  action: Action,
  clock: Clock,
  settings: Settings,
): ReduceResult {
  const ctx: Ctx = {
    state: clone(state),
    clock,
    settings,
    now: toInstant(clock),
    today: todayISO(clock),
    events: [],
  };
  const result = run(ctx, action);
  // A failed precondition hands back the caller's own (untouched) state object.
  return result.changed ? result : { ...result, state };
}

function run(ctx: Ctx, action: Action): ReduceResult {
  switch (action.type) {
    case 'add':
      return add(ctx, action.parsed, action.source, action.target);
    case 'done':
      return done(ctx, action.id);
    case 'undo':
      return undo(ctx, action.id);
    case 'skip':
      return skip(ctx, action.id);
    case 'drop':
      return drop(ctx, action.id);
    case 'start':
      return start(ctx, action.id);
    case 'extend':
      return extend(ctx, action.id, action.minutes);
    case 'reschedule':
      return reschedule(ctx, action.id, action.to);
    case 'setBlock':
      return setBlock(ctx, action.id, action.start, action.minutes);
    case 'clearBlock':
      return clearBlock(ctx, action.id);
    case 'shiftBlock':
      return shiftBlock(ctx, action.id, action.minutes);
    case 'nextSlot':
      return nextSlot(ctx, action.id);
    case 'edit':
      return edit(ctx, action.id, action.patch, action.by);
    case 'accept':
      return accept(ctx, action.id);
    case 'freshStart':
      return freshStart(ctx);
    case 'rollover':
      return rollover(ctx);
    case 'commitEvening':
      return commitEvening(ctx, action.ids, action.cues);
    case 'ingest':
      return ingest(ctx, action.command, action.file);
    case 'archive':
      return archive(ctx, action.ids);
  }
}
