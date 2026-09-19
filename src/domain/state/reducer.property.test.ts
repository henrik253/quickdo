/**
 * Property tests (fast-check) over random action sequences. Every property runs a fresh sequence
 * against a seeded state and checks the reducer's invariants after every step:
 * never throws, never mutates its input, ids stay unique, rescheduleCount is monotonic per item,
 * unknown item fields survive, the output always satisfies the on-disk schema, every event is
 * stamped with the clock, and no action ever moves more than ONE other block ([F-013]).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseCapture } from '../capture/parseCapture';
import { parseTodosFile } from '../schema/index';
import {
  clockAt,
  FIXED_NOW,
  item,
  settings,
  stateWith,
  TODAY,
  TOMORROW,
  YESTERDAY,
} from '../testing/fixtures';
import { minToHHMM, todayISO, toInstant } from '../time';
import type {
  Action,
  Clock,
  EditablePatch,
  HistoryEvent,
  InboxCommand,
  Item,
  ParsedCapture,
  State,
} from '../types';
import { derive } from './derive';
import { reduce } from './reducer';

// ---------- arbitraries ----------

const hhmm = fc.integer({ min: 96, max: 263 }).map((n) => minToHHMM(n * 5)); // 08:00–21:55
const date = fc.constantFrom(YESTERDAY, TODAY, TOMORROW, '2026-09-21', '2026-09-30');
const title = fc.oneof(
  fc.constantFrom('Read paper X', 'Reply to alice', 'Lecture A notes', '', '   '),
  fc.string({ maxLength: 40 }),
);
const blockMinutes = fc.constantFrom(5, 15, 30, 45, 60, 90, 120);
const opt = <T>(arb: fc.Arbitrary<T>) => fc.option(arb, { nil: undefined });

const parsedArb: fc.Arbitrary<ParsedCapture> = fc
  .record({
    title,
    scheduledFor: opt(date),
    block: opt(fc.record({ start: hhmm, minutes: blockMinutes })),
    wantsSlot: opt(fc.boolean()),
    estimateMin: opt(fc.integer({ min: 1, max: 180 })), // 0 → 0-minute block, see the known gap below
    project: opt(fc.constantFrom('thesis', 'home')),
    tags: fc.array(fc.constantFrom('mail', 'urgent', 'read'), { maxLength: 3 }),
    cue: opt(fc.constantFrom('after lunch', 'when home')),
    fallback: opt(fc.record({ minutes: fc.integer({ min: 1, max: 60 }) })),
    repeat: opt(fc.constantFrom('daily', 'weekdays', 'weekly:mon') as fc.Arbitrary<'daily'>),
    due: opt(date),
  })
  .map((p) => ({ ...p, tokens: [], warnings: [] }));

const captureText = fc
  .array(
    fc.constantFrom(
      'Read',
      'paper',
      'X',
      '!today',
      '!tmr',
      '!mon',
      '!!',
      '@9',
      '@14:30',
      '@tue 14:00',
      '~30m',
      '~2h',
      '#thesis',
      '+mail',
      'every day',
      'due fri',
      'when home',
      '"quoted !today"',
      '?filter',
    ),
    { maxLength: 6 },
  )
  .map((ws) => ws.join(' '));

/** Which item an action targets: an index into the current items, or a missing id. */
const idx = fc.option(fc.nat({ max: 999 }), { nil: null, freq: 12 });

const editPatch: fc.Arbitrary<EditablePatch> = fc.record(
  {
    title: fc.constantFrom('Read paper X', 'Reply to alice', ' ', 'x'.repeat(40)),
    note: opt(fc.string({ maxLength: 30 })),
    cue: opt(fc.constantFrom('after lunch', 'when home')),
    fallback: opt(fc.record({ minutes: fc.integer({ min: 1, max: 60 }), at: hhmm })),
    estimateMin: opt(fc.integer({ min: 1, max: 300 })),
    block: opt(fc.record({ start: hhmm, minutes: blockMinutes })),
    due: opt(date),
    project: opt(fc.constantFrom('thesis', 'home')),
    tags: fc.array(fc.constantFrom('mail', 'urgent'), { maxLength: 2 }),
    repeat: opt(fc.constantFrom('daily', 'weekdays') as fc.Arbitrary<'daily'>),
    order: fc.integer({ min: -50, max: 50 }),
    checkpoint: fc.option(hhmm, { nil: null }),
    scheduledFor: opt(date),
  },
  { requiredKeys: [] },
);

type IngestTpl =
  | { op: 'add'; title: string; dedupeKey?: string; note?: string; suggestedFor?: string }
  | {
      op: 'update';
      idx: number | null;
      byKey: boolean;
      base: 'match' | 'stale' | 'none';
      patch: Record<string, unknown>;
    }
  | { op: 'done'; idx: number | null; byKey: boolean; base: 'match' | 'stale' }
  | { op: 'ping' };

const ingestTpl: fc.Arbitrary<IngestTpl> = fc.oneof(
  fc.record({
    op: fc.constant('add' as const),
    title: fc.constantFrom('Reply to alice', 'Read paper X', ' '),
    dedupeKey: opt(fc.constantFrom('k1', 'k2', 'k3')),
    note: opt(fc.string({ maxLength: 30 })),
    suggestedFor: opt(date),
  }),
  fc.record({
    op: fc.constant('update' as const),
    idx,
    byKey: fc.boolean(),
    base: fc.constantFrom('match', 'stale', 'none') as fc.Arbitrary<'match'>,
    patch: fc.record(
      {
        title: fc.constantFrom('New title', ' '),
        note: fc.string({ maxLength: 30 }),
        due: date,
        estimateMin: fc.integer({ min: 1, max: 300 }),
        project: fc.constantFrom('thesis', 'home'),
        tags: fc.array(fc.constantFrom('mail', 'urgent'), { maxLength: 2 }),
        cue: fc.constantFrom('after lunch'),
        suggestedFor: date,
        ref: fc.constantFrom('https://example.com/issues/1', 'https://example.com/issues/2'),
      },
      { requiredKeys: [] },
    ),
  }),
  fc.record({
    op: fc.constant('done' as const),
    idx,
    byKey: fc.boolean(),
    base: fc.constantFrom('match', 'stale') as fc.Arbitrary<'match'>,
  }),
  fc.record({ op: fc.constant('ping' as const) }),
);

/** An action template; `idx` is resolved against the state at the time the step runs. */
type Tpl =
  | {
      type: 'add';
      parsed: ParsedCapture;
      source: 'ui' | 'hotkey' | 'cli';
      target?: 'today' | 'backlog' | 'today+slot';
    }
  | { type: 'capture'; text: string; target?: 'today' | 'backlog' | 'today+slot' }
  | {
      type: 'done' | 'undo' | 'skip' | 'drop' | 'start' | 'clearBlock' | 'nextSlot' | 'accept';
      idx: number | null;
    }
  | { type: 'extend'; idx: number | null; minutes?: number }
  | { type: 'reschedule'; idx: number | null; to: string | null }
  | { type: 'setBlock'; idx: number | null; start: string; minutes?: number }
  | { type: 'shiftBlock'; idx: number | null; minutes: number }
  | { type: 'edit'; idx: number | null; patch: EditablePatch }
  | { type: 'commitEvening'; idxs: number[]; cue: string }
  | { type: 'freshStart' | 'rollover' }
  | { type: 'ingest'; tpl: IngestTpl };

const target = opt(fc.constantFrom('today', 'backlog', 'today+slot') as fc.Arbitrary<'today'>);

const tplArb: fc.Arbitrary<Tpl> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({
      type: fc.constant('add' as const),
      parsed: parsedArb,
      source: fc.constantFrom('ui', 'hotkey', 'cli') as fc.Arbitrary<'ui'>,
      target,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ type: fc.constant('capture' as const), text: captureText, target }),
  },
  {
    weight: 6,
    arbitrary: fc.record({
      type: fc.constantFrom(
        'done',
        'undo',
        'skip',
        'drop',
        'start',
        'clearBlock',
        'nextSlot',
        'accept',
      ) as fc.Arbitrary<'done'>,
      idx,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant('extend' as const),
      idx,
      minutes: opt(fc.constantFrom(5, 10, 15, 30)),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant('reschedule' as const),
      idx,
      to: fc.option(date, { nil: null }),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant('setBlock' as const),
      idx,
      start: hhmm,
      minutes: opt(blockMinutes),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant('shiftBlock' as const),
      idx,
      minutes: fc.constantFrom(-60, -15, -5, 5, 15, 60),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ type: fc.constant('edit' as const), idx, patch: editPatch }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant('commitEvening' as const),
      idxs: fc.array(fc.nat({ max: 999 }), { maxLength: 3 }),
      cue: fc.constantFrom('after breakfast', '', '  '),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constantFrom('freshStart', 'rollover') as fc.Arbitrary<'freshStart'>,
    }),
  },
  { weight: 2, arbitrary: fc.record({ type: fc.constant('ingest' as const), tpl: ingestTpl }) },
);

const clockArb = fc.constantFrom(
  FIXED_NOW,
  '2026-09-18T15:00:00+02:00',
  '2026-09-18T21:50:00+02:00',
  '2026-09-19T08:00:00+02:00',
);

const sequence = fc.array(fc.tuple(tplArb, clockArb), { minLength: 1, maxLength: 30 });

// ---------- seed state ----------

const EXT = { keep: true, nested: [1, { two: 2 }] };

function seedState(): State {
  const base = stateWith([
    item({ id: 'today-a', scheduledFor: TODAY, block: { start: '09:00', minutes: 30 }, _ext: EXT }),
    item({ id: 'today-b', scheduledFor: TODAY, block: { start: '10:00', minutes: 60 }, _ext: EXT }),
    item({ id: 'today-c', scheduledFor: TODAY, block: { start: '11:00', minutes: 30 }, _ext: EXT }),
    item({ id: 'today-d', scheduledFor: TODAY, estimateMin: 45, _ext: EXT }),
    item({ id: 'today-skipped', scheduledFor: TODAY, status: 'skipped', skippedOn: TODAY }),
    item({ id: 'done', scheduledFor: TODAY, status: 'done', completedAt: FIXED_NOW, _ext: EXT }),
    item({ id: 'dropped', status: 'dropped', droppedAt: FIXED_NOW }),
    item({ id: 'backlog-1', order: 1, _ext: EXT }),
    item({ id: 'backlog-2', order: 2, suggestedFor: TOMORROW }),
    item({ id: 'stale', scheduledFor: YESTERDAY, block: { start: '15:00', minutes: 30 } }),
    item({ id: 'tomorrow', scheduledFor: TOMORROW, block: { start: '09:00', minutes: 60 } }),
    item({ id: 'habit', repeat: 'daily', _ext: EXT }),
    item({ id: 'agent', source: { kind: 'agent', by: 'hermes', dedupeKey: 'k1' }, _ext: EXT }),
  ]);
  return {
    ...base,
    schedule: {
      ...base.schedule,
      anchors: [{ name: 'Lecture A', days: ['fri', 'sat'], start: '13:00', end: '14:00' }],
    },
  };
}

// ---------- template → action ----------

function pick(state: State, i: number | null): string {
  const items = state.todos.items;
  if (i === null || items.length === 0) return 'missing';
  return items[i % items.length].id;
}

function toAction(state: State, tpl: Tpl, clock: Clock): Action {
  switch (tpl.type) {
    case 'add':
      return { type: 'add', parsed: tpl.parsed, source: { kind: tpl.source }, target: tpl.target };
    case 'capture':
      return {
        type: 'add',
        parsed: parseCapture(tpl.text, clock, settings),
        source: { kind: 'ui' },
        target: tpl.target,
      };
    case 'extend':
      return { type: 'extend', id: pick(state, tpl.idx), minutes: tpl.minutes };
    case 'reschedule':
      return { type: 'reschedule', id: pick(state, tpl.idx), to: tpl.to };
    case 'setBlock':
      return { type: 'setBlock', id: pick(state, tpl.idx), start: tpl.start, minutes: tpl.minutes };
    case 'shiftBlock':
      return { type: 'shiftBlock', id: pick(state, tpl.idx), minutes: tpl.minutes };
    case 'edit':
      return { type: 'edit', id: pick(state, tpl.idx), patch: tpl.patch };
    case 'commitEvening': {
      const ids = tpl.idxs.map((i) => pick(state, i));
      return {
        type: 'commitEvening',
        ids,
        cues: Object.fromEntries(ids.map((id) => [id, tpl.cue])),
      };
    }
    case 'freshStart':
    case 'rollover':
      return { type: tpl.type };
    case 'ingest':
      return {
        type: 'ingest',
        command: toCommand(state, tpl.tpl, clock),
        file: '20260918T070300000Z-x.json',
      };
    default:
      return { type: tpl.type, id: pick(state, tpl.idx) };
  }
}

function toCommand(state: State, tpl: IngestTpl, clock: Clock): InboxCommand {
  const at = toInstant(clock);
  if (tpl.op === 'ping') return { v: 1, op: 'ping', by: 'hermes', at };
  if (tpl.op === 'add') {
    return {
      v: 1,
      op: 'add',
      by: 'hermes',
      at,
      item: {
        title: tpl.title,
        dedupeKey: tpl.dedupeKey,
        note: tpl.note,
        suggestedFor: tpl.suggestedFor,
      },
    };
  }
  const id = pick(state, tpl.idx);
  const it = state.todos.items.find((x) => x.id === id);
  const ref = tpl.byKey ? { dedupeKey: it?.source.dedupeKey ?? 'k-missing' } : { id };
  const base =
    tpl.base === 'match'
      ? it?.updatedAt
      : tpl.base === 'stale'
        ? '2026-01-01T00:00:00+01:00'
        : undefined;
  if (tpl.op === 'done') {
    return {
      v: 1,
      op: 'done',
      by: 'hermes',
      at,
      ...ref,
      baseUpdatedAt: base ?? '2026-01-01T00:00:00+01:00',
    };
  }
  return { v: 1, op: 'update', by: 'hermes', at, ...ref, baseUpdatedAt: base, patch: tpl.patch };
}

// ---------- invariants ----------

const BATCH_ACTIONS = new Set<Action['type']>(['freshStart', 'rollover', 'commitEvening']);

function byId(state: State): Map<string, Item> {
  return new Map(state.todos.items.map((it) => [it.id, it]));
}

function checkStep(before: State, action: Action, clock: Clock, events: HistoryEvent[]): State {
  const stateSnapshot = JSON.stringify(before);
  const actionSnapshot = JSON.stringify(action);
  const r = reduce(before, action, clock, settings);

  // never mutates its input (state or action)
  expect(JSON.stringify(before)).toBe(stateSnapshot);
  expect(JSON.stringify(action)).toBe(actionSnapshot);

  // a failed precondition hands back the same object and no events
  if (!r.changed) {
    expect(r.state).toBe(before);
    expect(r.events).toEqual([]);
    return before;
  }
  expect(r.state).not.toBe(before);

  const after = r.state;
  const ids = after.todos.items.map((it) => it.id);
  expect(new Set(ids).size).toBe(ids.length);

  const prev = byId(before);
  const next = byId(after);
  let otherBlockChanges = 0;
  const targetId = r.item?.id ?? ('id' in action ? action.id : undefined);
  for (const [id, was] of prev) {
    const now = next.get(id);
    expect(now, `item ${id} vanished`).toBeDefined();
    if (!now) continue;
    expect(now.rescheduleCount).toBeGreaterThanOrEqual(was.rescheduleCount);
    if ('_ext' in was) expect(now._ext).toEqual(was._ext);
    expect(now.createdAt).toBe(was.createdAt);
    expect(now.id).toBe(was.id);
    if (id !== targetId && JSON.stringify(was.block) !== JSON.stringify(now.block)) {
      otherBlockChanges += 1;
    }
  }
  if (!BATCH_ACTIONS.has(action.type)) {
    expect(
      otherBlockChanges,
      `${action.type} moved ${otherBlockChanges} other blocks`,
    ).toBeLessThanOrEqual(1);
  }

  // every event is stamped with the clock
  for (const ev of r.events) {
    expect(ev.ts).toBe(toInstant(clock));
    expect(ev.day).toBe(todayISO(clock));
  }
  // batch actions may legitimately change only the day state (e.g. commitEvening with no ids)
  if (!BATCH_ACTIONS.has(action.type)) expect(r.events.length).toBeGreaterThan(0);
  expect(after.todos.updatedAt).toBe(toInstant(clock));
  events.push(...r.events);

  // the result is always a valid todos.json
  expect(() => parseTodosFile(after.todos)).not.toThrow();
  return after;
}

// ---------- properties ----------

describe('reducer: properties', () => {
  it('[F-001] random action sequences never throw, keep ids unique and never mutate the input', () => {
    fc.assert(
      fc.property(sequence, (steps) => {
        let state = seedState();
        const events: HistoryEvent[] = [];
        for (const [tpl, iso] of steps) {
          const clock = clockAt(iso);
          state = checkStep(state, toAction(state, tpl, clock), clock, events);
        }
      }),
      { numRuns: 120 },
    );
  });

  it('[F-004] rescheduleCount never decreases and unknown item fields survive every action', () => {
    fc.assert(
      fc.property(sequence, (steps) => {
        let state = seedState();
        const counts = new Map(state.todos.items.map((it) => [it.id, it.rescheduleCount]));
        for (const [tpl, iso] of steps) {
          const clock = clockAt(iso);
          const r = reduce(state, toAction(state, tpl, clock), clock, settings);
          state = r.state;
          for (const it of state.todos.items) {
            const prevCount = counts.get(it.id);
            if (prevCount !== undefined)
              expect(it.rescheduleCount).toBeGreaterThanOrEqual(prevCount);
            counts.set(it.id, it.rescheduleCount);
          }
        }
        for (const it of state.todos.items) {
          if (seedState().todos.items.find((s) => s.id === it.id)?._ext)
            expect(it._ext).toEqual(EXT);
        }
      }),
      { numRuns: 60 },
    );
  });

  it('[F-013] after any single-item action at most ONE other block changed', () => {
    const blockActions = fc.array(
      fc.tuple(
        fc.oneof(
          fc.record({
            type: fc.constant('setBlock' as const),
            idx,
            start: hhmm,
            minutes: opt(blockMinutes),
          }),
          fc.record({
            type: fc.constant('extend' as const),
            idx,
            minutes: opt(fc.constantFrom(5, 15, 30)),
          }),
          fc.record({ type: fc.constant('nextSlot' as const), idx }),
          fc.record({
            type: fc.constant('shiftBlock' as const),
            idx,
            minutes: fc.constantFrom(-15, 15, 60),
          }),
          fc.record({
            type: fc.constant('add' as const),
            parsed: parsedArb,
            source: fc.constant('ui' as const),
            target,
          }),
        ) as fc.Arbitrary<Tpl>,
        clockArb,
      ),
      { minLength: 1, maxLength: 25 },
    );
    fc.assert(
      fc.property(blockActions, (steps) => {
        let state = seedState();
        const events: HistoryEvent[] = [];
        for (const [tpl, iso] of steps) {
          const clock = clockAt(iso);
          state = checkStep(state, toAction(state, tpl, clock), clock, events);
        }
      }),
      { numRuns: 120 },
    );
  });

  it('[F-004] derive never throws on any reachable state and keeps the lists disjoint', () => {
    fc.assert(
      fc.property(sequence, (steps) => {
        let state = seedState();
        const events: HistoryEvent[] = [];
        for (const [tpl, iso] of steps) {
          const clock = clockAt(iso);
          const r = reduce(state, toAction(state, tpl, clock), clock, settings);
          state = r.state;
          events.push(...r.events);
          const d = derive(state, clock, settings, events);
          const today = new Set(d.today.map((it) => it.id));
          for (const it of d.today) expect(it.scheduledFor).toBe(d.date);
          for (const it of d.backlog) {
            expect(today.has(it.id)).toBe(false);
            expect(it.scheduledFor).toBeUndefined();
          }
          for (const it of d.doneToday) expect(today.has(it.id)).toBe(false);
          for (const it of state.todos.items) {
            if (it.status !== 'dropped') expect(d.padded[it.id]).toBeGreaterThanOrEqual(0);
          }
          expect(d.progress.segments).toHaveLength(d.doneToday.length + d.today.length);
          expect(d.capacity.level).toBe(
            d.capacity.ratio >= 1 ? 'red' : d.capacity.ratio >= 0.9 ? 'amber' : 'ok',
          );
        }
      }),
      { numRuns: 60 },
    );
  });

  it('[F-026] ingesting the same add command twice is idempotent (second is a duplicate)', () => {
    const cmd = fc.record({
      title: fc.constantFrom('Reply to alice', 'Read paper X'),
      dedupeKey: fc.constantFrom('k1', 'k9', 'issue-1'),
      suggestedFor: opt(date),
    });
    fc.assert(
      fc.property(cmd, sequence, (item, steps) => {
        const clock = clockAt(FIXED_NOW);
        const command: InboxCommand = { v: 1, op: 'add', by: 'hermes', at: FIXED_NOW, item };
        let state = seedState();
        for (const [tpl, iso] of steps) {
          const c = clockAt(iso);
          state = reduce(state, toAction(state, tpl, c), c, settings).state;
        }
        const first = reduce(state, { type: 'ingest', command, file: 'a.json' }, clock, settings);
        const second = reduce(
          first.state,
          { type: 'ingest', command, file: 'a.json' },
          clock,
          settings,
        );
        expect(second.changed).toBe(false);
        expect(second.warning).toBe('duplicate');
        expect(second.state).toBe(first.state);
        const matches = first.state.todos.items.filter(
          (it) => it.source.dedupeKey === item.dedupeKey,
        );
        expect(matches).toHaveLength(1);
      }),
      { numRuns: 40 },
    );
  });
});

describe('reducer: zero estimates create zero-minute blocks (known gap)', () => {
  // padded(0) is 0, so every path that sizes a block from the estimate (add with a slot,
  // setBlock/nextSlot without explicit minutes) writes block.minutes = 0, which the schema
  // rejects (min 5). Flip to plain `it` once the reducer floors the block length at 5 minutes.
  it.fails('[F-006] add with a slot and estimateMin 0 yields a schema-valid block', () => {
    const parsed: ParsedCapture = {
      title: 'Read paper X',
      estimateMin: 0,
      wantsSlot: true,
      tags: [],
      tokens: [],
      warnings: [],
    };
    const r = reduce(
      stateWith([]),
      { type: 'add', parsed, source: { kind: 'ui' }, target: 'today' },
      clockAt(FIXED_NOW),
      settings,
    );
    expect(r.item?.block?.minutes ?? 5).toBeGreaterThanOrEqual(5);
    expect(() => parseTodosFile(r.state.todos)).not.toThrow();
  });

  it.fails('[F-009] setBlock without minutes on an item with estimateMin 0 yields a schema-valid block', () => {
    const state = stateWith([item({ id: 'a', scheduledFor: TODAY, estimateMin: 0 })]);
    const r = reduce(
      state,
      { type: 'setBlock', id: 'a', start: '10:00' },
      clockAt(FIXED_NOW),
      settings,
    );
    expect(() => parseTodosFile(r.state.todos)).not.toThrow();
  });
});

describe('reducer: edit with undefined required fields (known gap)', () => {
  // applyPatch deletes any key whose patch value is `undefined`, including the required ones.
  // These flip to failing once the reducer guards `title`/`tags`/`order` — then drop `.fails`.
  it.fails('[F-001] edit { title: undefined } must not throw', () => {
    const state = stateWith([item({ id: 'a' })]);
    expect(() =>
      reduce(
        state,
        { type: 'edit', id: 'a', patch: { title: undefined } },
        clockAt(FIXED_NOW),
        settings,
      ),
    ).not.toThrow();
  });

  it.fails('[F-001] edit { tags: undefined } keeps the item schema-valid', () => {
    const state = stateWith([item({ id: 'a' })]);
    const r = reduce(
      state,
      { type: 'edit', id: 'a', patch: { tags: undefined } },
      clockAt(FIXED_NOW),
      settings,
    );
    expect(() => parseTodosFile(r.state.todos)).not.toThrow();
  });
});
