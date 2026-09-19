import { describe, expect, it } from 'vitest';
import {
  clock,
  clockAt,
  item,
  parsed,
  settings,
  stateWith,
  TODAY,
  TOMORROW,
  YESTERDAY,
} from '../testing/fixtures';
import type { Action, InboxAddItem, InboxCommand, Item, State } from '../types';
import { newId, reduce } from './reducer';

const NOW = '2026-09-18T09:12:00+02:00';

function run(state: State, action: Action, c = clock) {
  return reduce(state, action, c, settings);
}

function get(state: State, id: string): Item {
  const it = state.todos.items.find((x) => x.id === id);
  if (!it) throw new Error(`missing ${id}`);
  return it;
}

describe('reducer: purity and ids', () => {
  it('[F-001] never mutates its input state', () => {
    const a = item({ id: 'a', scheduledFor: TODAY });
    const state = stateWith([a]);
    const snapshot = JSON.stringify(state);
    run(state, { type: 'done', id: 'a' });
    run(state, { type: 'add', parsed: parsed(), source: { kind: 'ui' } });
    run(state, { type: 'freshStart' });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('[F-001] returns the same state object and no events when a precondition fails', () => {
    const state = stateWith([item({ id: 'a', status: 'done' })]);
    const r = run(state, { type: 'done', id: 'a' });
    expect(r.state).toBe(state);
    expect(r.changed).toBe(false);
    expect(r.events).toEqual([]);
    expect(r.warning).toBeDefined();
  });

  it('[F-001] newId yields unique ULIDs seeded with the clock time', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId(clock)));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    // the time part encodes the fixed clock, so ids from the same instant share their prefix
    const [x, y] = [...ids];
    expect(x.slice(0, 10)).toBe(y.slice(0, 10));
  });

  it('[F-001] stamps every event with ts = toInstant(clock) and day = todayISO(clock)', () => {
    const r = run(stateWith([]), { type: 'add', parsed: parsed(), source: { kind: 'ui' } });
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ ts: NOW, day: TODAY, type: 'added' });
    expect(r.state.todos.updatedAt).toBe(NOW);
  });
});

describe('reducer: add', () => {
  it('[F-001] rejects an empty title with warning "no title"', () => {
    const state = stateWith([]);
    const r = run(state, { type: 'add', parsed: parsed({ title: '  ' }), source: { kind: 'ui' } });
    expect(r).toMatchObject({ changed: false, warning: 'no title', state });
  });

  it('[F-004] adds to the Backlog by default, at the top (min order − 1)', () => {
    const state = stateWith([item({ id: 'b1', order: 3 }), item({ id: 'b2', order: 7 })]);
    const r = run(state, {
      type: 'add',
      parsed: parsed({ title: 'Read paper X' }),
      source: { kind: 'hotkey' },
    });
    expect(r.changed).toBe(true);
    expect(r.item).toMatchObject({
      title: 'Read paper X',
      status: 'open',
      order: 2,
      rescheduleCount: 0,
      tags: [],
      source: { kind: 'hotkey' },
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(r.item?.scheduledFor).toBeUndefined();
    expect(r.state.todos.items).toHaveLength(3);
    expect(r.events[0]).toMatchObject({ type: 'added', itemId: r.item?.id, to: null });
  });

  it('[F-004] target today dates the item at the bottom of Today (max order + 1)', () => {
    const state = stateWith([item({ id: 't1', scheduledFor: TODAY, order: 5 })]);
    const r = run(state, {
      type: 'add',
      parsed: parsed(),
      source: { kind: 'ui' },
      target: 'today',
    });
    expect(r.item).toMatchObject({ scheduledFor: TODAY, order: 6 });
  });

  it('[F-004] parsed scheduledFor wins over the target', () => {
    const r = run(stateWith([]), {
      type: 'add',
      parsed: parsed({ scheduledFor: TOMORROW }),
      source: { kind: 'ui' },
      target: 'today',
    });
    expect(r.item?.scheduledFor).toBe(TOMORROW);
  });

  it('[F-002] copies every parsed field onto the item', () => {
    const r = run(stateWith([]), {
      type: 'add',
      parsed: parsed({
        title: 'Read paper X',
        estimateMin: 60,
        project: 'thesis',
        tags: ['mail'],
        cue: 'at the library',
        repeat: 'weekdays',
        due: '2026-09-30',
        fallback: { minutes: 15, at: '16:00' },
      }),
      source: { kind: 'cli' },
    });
    expect(r.item).toMatchObject({
      estimateMin: 60,
      project: 'thesis',
      tags: ['mail'],
      cue: 'at the library',
      repeat: 'weekdays',
      due: '2026-09-30',
      fallback: { minutes: 15, at: '16:00' },
    });
  });

  it('[F-009] a parsed block is stored and a checkpoint set on blocks ≥ 60 min', () => {
    const r = run(stateWith([]), {
      type: 'add',
      parsed: parsed({
        scheduledFor: TODAY,
        estimateMin: 60,
        block: { start: '14:00', minutes: 80 },
      }),
      source: { kind: 'ui' },
    });
    expect(r.item?.block).toEqual({ start: '14:00', minutes: 80 });
    expect(r.item?.checkpoint).toBe('14:40');
    expect(r.events.map((e) => e.type)).toEqual(['added', 'blocked']);
  });

  it('[F-009] target today+slot places a block at the next free slot after now, avoiding anchors and blocks', () => {
    const state = stateWith([
      item({ id: 'x', scheduledFor: TODAY, block: { start: '09:15', minutes: 30 } }),
    ]);
    state.schedule.anchors = [{ name: 'Lecture A', days: ['fri'], start: '10:00', end: '11:00' }];
    const r = run(state, {
      type: 'add',
      parsed: parsed({ estimateMin: 30 }),
      source: { kind: 'ui' },
      target: 'today+slot',
    });
    expect(r.item).toMatchObject({ scheduledFor: TODAY, block: { start: '11:00', minutes: 40 } });
  });

  it('[F-009] `!!` (wantsSlot) works like today+slot and never moves the other blocks', () => {
    const state = stateWith([
      item({ id: 'x', scheduledFor: TODAY, block: { start: '09:15', minutes: 30 } }),
    ]);
    const r = run(state, {
      type: 'add',
      parsed: parsed({ scheduledFor: TODAY, wantsSlot: true }),
      source: { kind: 'ui' },
    });
    expect(r.item?.block).toEqual({ start: '09:45', minutes: 40 });
    expect(get(r.state, 'x').block).toEqual({ start: '09:15', minutes: 30 });
  });

  it('[F-009] wantsSlot on a future day starts the search at the day start', () => {
    const r = run(stateWith([]), {
      type: 'add',
      parsed: parsed({ scheduledFor: TOMORROW, wantsSlot: true }),
      source: { kind: 'ui' },
    });
    expect(r.item?.block).toEqual({ start: '08:00', minutes: 40 });
  });

  it('[F-010] wantsSlot with no free slot adds the item without a block', () => {
    const r = run(
      stateWith([]),
      {
        type: 'add',
        parsed: parsed({ scheduledFor: TODAY, wantsSlot: true }),
        source: { kind: 'ui' },
      },
      clockAt('2026-09-18T21:50:00+02:00'),
    );
    expect(r.changed).toBe(true);
    expect(r.item?.block).toBeUndefined();
    expect(r.events[0].detail).toBe('no free slot');
  });
});

describe('reducer: done / undo / skip / drop', () => {
  it('[F-008] done sets status, completedAt and clears startedAt', () => {
    const state = stateWith([item({ id: 'a', scheduledFor: TODAY, startedAt: NOW })]);
    const r = run(state, { type: 'done', id: 'a' });
    expect(get(r.state, 'a')).toMatchObject({ status: 'done', completedAt: NOW, updatedAt: NOW });
    expect(get(r.state, 'a').startedAt).toBeUndefined();
    expect(r.events).toEqual([{ ts: NOW, day: TODAY, type: 'done', itemId: 'a', by: undefined }]);
  });

  it('[F-008] done works on a skipped item and refuses done/dropped ones', () => {
    expect(
      run(stateWith([item({ id: 'a', status: 'skipped' })]), { type: 'done', id: 'a' }).changed,
    ).toBe(true);
    expect(
      run(stateWith([item({ id: 'a', status: 'done' })]), { type: 'done', id: 'a' }).warning,
    ).toBe('already done');
    expect(
      run(stateWith([item({ id: 'a', status: 'dropped' })]), { type: 'done', id: 'a' }).warning,
    ).toBe('already dropped');
    expect(run(stateWith([]), { type: 'done', id: 'zz' }).warning).toBe('not_found');
  });

  it('[F-018] done on a repeat item leaves the status open and records history only', () => {
    const state = stateWith([item({ id: 'h', repeat: 'daily' })]);
    const r = run(state, { type: 'done', id: 'h' });
    expect(r.changed).toBe(true);
    expect(get(r.state, 'h').status).toBe('open');
    expect(get(r.state, 'h').completedAt).toBeUndefined();
    expect(r.events[0]).toMatchObject({ type: 'done', itemId: 'h', day: TODAY });
  });

  it('[F-008] undo reopens done and skipped items and refuses open ones', () => {
    const done = stateWith([item({ id: 'a', status: 'done', completedAt: NOW })]);
    const r1 = run(done, { type: 'undo', id: 'a' });
    expect(get(r1.state, 'a').status).toBe('open');
    expect(get(r1.state, 'a').completedAt).toBeUndefined();
    expect(r1.events[0].type).toBe('undone');
    const skipped = stateWith([item({ id: 'a', status: 'skipped', skippedOn: TODAY })]);
    const r2 = run(skipped, { type: 'undo', id: 'a' });
    expect(get(r2.state, 'a')).toMatchObject({ status: 'open' });
    expect(get(r2.state, 'a').skippedOn).toBeUndefined();
    expect(run(stateWith([item({ id: 'a' })]), { type: 'undo', id: 'a' }).warning).toMatch(
      /not done/,
    );
  });

  it('[F-018] undo on a repeat item emits history "undone" (the per-day outcome lives in history)', () => {
    const r = run(stateWith([item({ id: 'h', repeat: 'daily' })]), { type: 'undo', id: 'h' });
    expect(r.changed).toBe(true);
    expect(r.events[0]).toMatchObject({ type: 'undone', itemId: 'h' });
    expect(get(r.state, 'h').status).toBe('open');
  });

  it('[F-014] skip marks the day, clears startedAt, and only works on open items', () => {
    const r = run(stateWith([item({ id: 'a', startedAt: NOW })]), { type: 'skip', id: 'a' });
    expect(get(r.state, 'a')).toMatchObject({ status: 'skipped', skippedOn: TODAY });
    expect(get(r.state, 'a').startedAt).toBeUndefined();
    expect(r.events[0].type).toBe('skipped');
    expect(
      run(stateWith([item({ id: 'a', status: 'done' })]), { type: 'skip', id: 'a' }).warning,
    ).toBe('already done');
    const rep = run(stateWith([item({ id: 'h', repeat: 'daily' })]), { type: 'skip', id: 'h' });
    expect(get(rep.state, 'h').status).toBe('open');
    expect(rep.events[0].type).toBe('skipped');
  });

  it('[F-020] drop works on open and skipped items, never on done ones', () => {
    const r = run(stateWith([item({ id: 'a' })]), { type: 'drop', id: 'a' });
    expect(get(r.state, 'a')).toMatchObject({ status: 'dropped', droppedAt: NOW });
    expect(r.events[0].type).toBe('dropped');
    expect(
      run(stateWith([item({ id: 'a', status: 'skipped' })]), { type: 'drop', id: 'a' }).changed,
    ).toBe(true);
    expect(
      run(stateWith([item({ id: 'a', status: 'done' })]), { type: 'drop', id: 'a' }).warning,
    ).toBe('already done');
    expect(
      run(stateWith([item({ id: 'a', status: 'dropped' })]), { type: 'drop', id: 'a' }).warning,
    ).toBe('already dropped');
  });
});

describe('reducer: start / extend / blocks', () => {
  it('[F-017] start records startedAt and history only for items on Today', () => {
    const r = run(stateWith([item({ id: 'a', scheduledFor: TODAY })]), { type: 'start', id: 'a' });
    expect(get(r.state, 'a').startedAt).toBe(NOW);
    expect(r.events[0]).toMatchObject({ type: 'started', itemId: 'a' });
    expect(run(stateWith([item({ id: 'a' })]), { type: 'start', id: 'a' }).warning).toBe(
      'not on Today',
    );
    expect(
      run(stateWith([item({ id: 'a', scheduledFor: TOMORROW })]), { type: 'start', id: 'a' })
        .warning,
    ).toBe('not on Today');
    expect(
      run(stateWith([item({ id: 'h', repeat: 'daily' })]), { type: 'start', id: 'h' }).changed,
    ).toBe(true);
  });

  it('[F-009] extend adds 15 minutes by default, or the given amount', () => {
    const state = stateWith([
      item({ id: 'a', scheduledFor: TODAY, block: { start: '10:00', minutes: 30 } }),
    ]);
    expect(get(run(state, { type: 'extend', id: 'a' }).state, 'a').block).toEqual({
      start: '10:00',
      minutes: 45,
    });
    expect(get(run(state, { type: 'extend', id: 'a', minutes: 30 }).state, 'a').block).toEqual({
      start: '10:00',
      minutes: 60,
    });
    expect(run(state, { type: 'extend', id: 'a' }).events[0]).toMatchObject({
      type: 'extended',
      from: '30',
      to: '45',
    });
    expect(run(stateWith([item({ id: 'a' })]), { type: 'extend', id: 'a' }).warning).toBe(
      'no block',
    );
  });

  it('[F-013] extend moves at most the ONE next block, by the overlap, and never a third', () => {
    const state = stateWith([
      item({ id: 'a', scheduledFor: TODAY, block: { start: '10:00', minutes: 30 } }),
      item({ id: 'b', scheduledFor: TODAY, block: { start: '10:30', minutes: 30 } }),
      item({ id: 'c', scheduledFor: TODAY, block: { start: '11:00', minutes: 30 } }),
      item({ id: 'd', scheduledFor: TOMORROW, block: { start: '10:30', minutes: 30 } }),
    ]);
    const r = run(state, { type: 'extend', id: 'a', minutes: 20 });
    expect(get(r.state, 'a').block).toEqual({ start: '10:00', minutes: 50 });
    expect(get(r.state, 'b').block).toEqual({ start: '10:50', minutes: 30 });
    expect(get(r.state, 'c').block).toEqual({ start: '11:00', minutes: 30 });
    expect(get(r.state, 'd').block).toEqual({ start: '10:30', minutes: 30 });
    expect(r.events.map((e) => e.type)).toEqual(['extended', 'rescheduled']);
    expect(r.events[1]).toMatchObject({
      itemId: 'b',
      from: '10:30',
      to: '10:50',
      scope: 'next_block_only',
    });
  });

  it('[F-013] extend does not touch a following block that still fits', () => {
    const state = stateWith([
      item({ id: 'a', scheduledFor: TODAY, block: { start: '10:00', minutes: 30 } }),
      item({ id: 'b', scheduledFor: TODAY, block: { start: '11:00', minutes: 30 } }),
    ]);
    const r = run(state, { type: 'extend', id: 'a' });
    expect(get(r.state, 'b').block).toEqual({ start: '11:00', minutes: 30 });
    expect(r.events).toHaveLength(1);
  });

  it('[F-009] setBlock needs a scheduled day, defaults minutes to the padded estimate, sets a checkpoint ≥ 60', () => {
    expect(
      run(stateWith([item({ id: 'a' })]), { type: 'setBlock', id: 'a', start: '10:00' }).warning,
    ).toBe('not scheduled');
    const r = run(stateWith([item({ id: 'a', scheduledFor: TOMORROW, estimateMin: 30 })]), {
      type: 'setBlock',
      id: 'a',
      start: '10:00',
    });
    expect(get(r.state, 'a').block).toEqual({ start: '10:00', minutes: 40 });
    expect(get(r.state, 'a').checkpoint).toBeUndefined();
    expect(r.events[0]).toMatchObject({ type: 'blocked', to: '10:00', from: null });
    const r2 = run(stateWith([item({ id: 'a', scheduledFor: TODAY })]), {
      type: 'setBlock',
      id: 'a',
      start: '10:00',
      minutes: 90,
    });
    expect(get(r2.state, 'a')).toMatchObject({
      block: { start: '10:00', minutes: 90 },
      checkpoint: '10:45',
    });
    const r3 = run(stateWith([item({ id: 'a', scheduledFor: TODAY, checkpoint: null })]), {
      type: 'setBlock',
      id: 'a',
      start: '10:00',
      minutes: 90,
    });
    expect(get(r3.state, 'a').checkpoint).toBeNull();
  });

  it('[F-009] clearBlock removes the block and needs one', () => {
    const r = run(
      stateWith([item({ id: 'a', scheduledFor: TODAY, block: { start: '10:00', minutes: 30 } })]),
      { type: 'clearBlock', id: 'a' },
    );
    expect(get(r.state, 'a').block).toBeUndefined();
    expect(r.events[0]).toMatchObject({ type: 'unblocked', from: '10:00' });
    expect(
      run(stateWith([item({ id: 'a', scheduledFor: TODAY })]), { type: 'clearBlock', id: 'a' })
        .warning,
    ).toBe('no block');
  });

  it('[F-009] shiftBlock moves ±minutes and clamps to the day window', () => {
    const state = stateWith([
      item({ id: 'a', scheduledFor: TODAY, block: { start: '08:10', minutes: 30 } }),
    ]);
    expect(
      get(run(state, { type: 'shiftBlock', id: 'a', minutes: 15 }).state, 'a').block?.start,
    ).toBe('08:25');
    expect(
      get(run(state, { type: 'shiftBlock', id: 'a', minutes: -15 }).state, 'a').block?.start,
    ).toBe('08:00');
    const late = stateWith([
      item({ id: 'a', scheduledFor: TODAY, block: { start: '21:40', minutes: 30 } }),
    ]);
    expect(
      get(run(late, { type: 'shiftBlock', id: 'a', minutes: 15 }).state, 'a').block?.start,
    ).toBe('21:30');
    expect(
      run(stateWith([item({ id: 'a' })]), { type: 'shiftBlock', id: 'a', minutes: 15 }).warning,
    ).toBe('no block');
  });

  it('[F-013] nextSlot moves THIS block to the next free slot after now and moves at most one other block', () => {
    const state = stateWith([
      item({ id: 'a', scheduledFor: TODAY, block: { start: '08:30', minutes: 30 } }),
      item({ id: 'b', scheduledFor: TODAY, block: { start: '09:30', minutes: 30 } }),
      item({ id: 'c', scheduledFor: TODAY, block: { start: '10:00', minutes: 60 } }),
    ]);
    state.schedule.anchors = [{ name: 'Lecture A', days: ['fri'], start: '11:00', end: '12:00' }];
    const r = run(state, { type: 'nextSlot', id: 'a' });
    expect(get(r.state, 'a').block).toEqual({ start: '12:00', minutes: 30 });
    expect(get(r.state, 'b').block).toEqual({ start: '09:30', minutes: 30 });
    expect(get(r.state, 'c').block).toEqual({ start: '10:00', minutes: 60 });
    expect(r.events[0]).toMatchObject({
      type: 'rescheduled',
      itemId: 'a',
      from: '08:30',
      to: '12:00',
      scope: 'next_block_only',
    });
    expect(r.events).toHaveLength(1);
  });

  it('[F-013] nextSlot on an unblocked Today item creates a block; refuses items elsewhere', () => {
    const r = run(stateWith([item({ id: 'a', scheduledFor: TODAY, estimateMin: 30 })]), {
      type: 'nextSlot',
      id: 'a',
    });
    expect(get(r.state, 'a').block).toEqual({ start: '09:15', minutes: 40 });
    expect(run(stateWith([item({ id: 'a' })]), { type: 'nextSlot', id: 'a' }).warning).toBe(
      'not on Today',
    );
    const full = run(
      stateWith([item({ id: 'a', scheduledFor: TODAY })]),
      { type: 'nextSlot', id: 'a' },
      clockAt('2026-09-18T21:45:00+02:00'),
    );
    expect(full.warning).toBe('no free slot');
  });
});

describe('reducer: reschedule / edit / accept', () => {
  it('[F-004] reschedule to a later day increments rescheduleCount and clears the block', () => {
    const state = stateWith([
      item({
        id: 'a',
        scheduledFor: TODAY,
        block: { start: '10:00', minutes: 30 },
        rescheduleCount: 1,
      }),
    ]);
    const r = run(state, { type: 'reschedule', id: 'a', to: TOMORROW });
    expect(get(r.state, 'a')).toMatchObject({ scheduledFor: TOMORROW, rescheduleCount: 2 });
    expect(get(r.state, 'a').block).toBeUndefined();
    expect(r.events[0]).toMatchObject({ type: 'rescheduled', from: TODAY, to: TOMORROW });
  });

  it('[F-004] reschedule to Backlog (null) increments; Backlog → today and earlier moves do not', () => {
    const r1 = run(stateWith([item({ id: 'a', scheduledFor: TODAY })]), {
      type: 'reschedule',
      id: 'a',
      to: null,
    });
    expect(get(r1.state, 'a').scheduledFor).toBeUndefined();
    expect(get(r1.state, 'a').rescheduleCount).toBe(1);
    const r2 = run(stateWith([item({ id: 'a' })]), { type: 'reschedule', id: 'a', to: TODAY });
    expect(get(r2.state, 'a')).toMatchObject({ scheduledFor: TODAY, rescheduleCount: 0 });
    const r3 = run(stateWith([item({ id: 'a', scheduledFor: TOMORROW })]), {
      type: 'reschedule',
      id: 'a',
      to: TODAY,
    });
    expect(get(r3.state, 'a').rescheduleCount).toBe(0);
  });

  it('[F-004] reschedule refuses dropped items and no-op moves', () => {
    expect(
      run(stateWith([item({ id: 'a', status: 'dropped' })]), {
        type: 'reschedule',
        id: 'a',
        to: TODAY,
      }).warning,
    ).toBe('gone');
    expect(
      run(stateWith([item({ id: 'a' })]), { type: 'reschedule', id: 'a', to: null }).warning,
    ).toBe('already in Backlog');
    expect(
      run(stateWith([item({ id: 'a', scheduledFor: TODAY })]), {
        type: 'reschedule',
        id: 'a',
        to: TODAY,
      }).warning,
    ).toBe(`already on ${TODAY}`);
  });

  it('[F-001] edit applies only the listed fields and records which ones changed', () => {
    const state = stateWith([item({ id: 'a', title: 'Read paper X', note: 'old' })]);
    const r = run(state, {
      type: 'edit',
      id: 'a',
      patch: { title: 'Read paper Y', estimateMin: 45, note: undefined },
    });
    expect(get(r.state, 'a')).toMatchObject({
      title: 'Read paper Y',
      estimateMin: 45,
      updatedAt: NOW,
    });
    expect(get(r.state, 'a').note).toBeUndefined();
    expect(r.events[0]).toMatchObject({ type: 'edited', detail: 'title,note,estimateMin' });
    const sneaky = { status: 'done', title: 'z' } as unknown as { title: string };
    expect(get(run(state, { type: 'edit', id: 'a', patch: sneaky }).state, 'a').status).toBe(
      'open',
    );
  });

  it('[F-001] edit refuses dropped items, empty titles and empty patches', () => {
    expect(
      run(stateWith([item({ id: 'a', status: 'dropped' })]), {
        type: 'edit',
        id: 'a',
        patch: { title: 'x' },
      }).warning,
    ).toBe('gone');
    expect(
      run(stateWith([item({ id: 'a' })]), { type: 'edit', id: 'a', patch: { title: ' ' } }).warning,
    ).toBe('no title');
    expect(run(stateWith([item({ id: 'a' })]), { type: 'edit', id: 'a', patch: {} }).warning).toBe(
      'nothing to change',
    );
    expect(run(stateWith([]), { type: 'edit', id: 'a', patch: { title: 'x' } }).warning).toBe(
      'not_found',
    );
  });

  it('[F-022] accept applies suggestedFor and clears it', () => {
    const state = stateWith([item({ id: 'a', suggestedFor: TOMORROW })]);
    const r = run(state, { type: 'accept', id: 'a' });
    expect(get(r.state, 'a').scheduledFor).toBe(TOMORROW);
    expect(get(r.state, 'a').suggestedFor).toBeUndefined();
    expect(get(r.state, 'a').rescheduleCount).toBe(0);
    expect(r.events[0]).toMatchObject({ type: 'accepted', to: TOMORROW });
    expect(run(stateWith([item({ id: 'a' })]), { type: 'accept', id: 'a' }).warning).toBe(
      'no suggestion',
    );
  });
});

describe('reducer: day-level actions', () => {
  it('[F-015] freshStart removes past-due blocks from Today items, keeps the items and future blocks', () => {
    const state = stateWith([
      item({ id: 'past', scheduledFor: TODAY, block: { start: '08:00', minutes: 30 } }),
      item({ id: 'running', scheduledFor: TODAY, block: { start: '09:00', minutes: 30 } }),
      item({ id: 'future', scheduledFor: TODAY, block: { start: '14:00', minutes: 30 } }),
      item({ id: 'tmr', scheduledFor: TOMORROW, block: { start: '08:00', minutes: 30 } }),
    ]);
    const r = run(state, { type: 'freshStart' });
    expect(r.state.day.freshStartAt).toBe('09:12');
    expect(get(r.state, 'past').block).toBeUndefined();
    expect(get(r.state, 'past').scheduledFor).toBe(TODAY);
    expect(get(r.state, 'running').block).toEqual({ start: '09:00', minutes: 30 });
    expect(get(r.state, 'future').block).toEqual({ start: '14:00', minutes: 30 });
    expect(get(r.state, 'tmr').block).toEqual({ start: '08:00', minutes: 30 });
    expect(r.events.map((e) => e.type)).toEqual(['unblocked', 'fresh_start']);
  });

  it("[F-004] rollover moves yesterday's open items to Backlog", () => {
    const state = stateWith(
      [
        item({
          id: 'y1',
          scheduledFor: YESTERDAY,
          order: 1,
          block: { start: '10:00', minutes: 30 },
        }),
        item({ id: 'y2', scheduledFor: YESTERDAY, order: 2 }),
        item({ id: 'old', scheduledFor: '2026-09-01' }),
        item({ id: 'ydone', scheduledFor: YESTERDAY, status: 'done' }),
        item({ id: 'yskip', scheduledFor: YESTERDAY, status: 'skipped' }),
        item({ id: 'habit', scheduledFor: YESTERDAY, repeat: 'daily' }),
        item({ id: 'today', scheduledFor: TODAY }),
        item({ id: 'bl', order: 10 }),
      ],
      { day: { date: YESTERDAY, freshStartAt: '15:00', eveningRitualDone: true } },
    );
    const r = run(state, { type: 'rollover' });
    expect(r.changed).toBe(true);
    expect(r.state.day).toEqual({ date: TODAY, freshStartAt: null, eveningRitualDone: false });
    for (const id of ['y1', 'y2', 'old']) {
      const it = get(r.state, id);
      expect(it.scheduledFor).toBeUndefined();
      expect(it.rescheduleCount).toBe(1);
      expect(it.block).toBeUndefined();
    }
    expect(get(r.state, 'y1').order).toBeLessThan(get(r.state, 'y2').order);
    expect(get(r.state, 'y2').order).toBeLessThan(get(r.state, 'bl').order);
    expect(get(r.state, 'ydone').scheduledFor).toBe(YESTERDAY);
    expect(get(r.state, 'yskip').scheduledFor).toBe(YESTERDAY);
    expect(get(r.state, 'habit').scheduledFor).toBe(YESTERDAY);
    expect(get(r.state, 'today').scheduledFor).toBe(TODAY);
    const moved = r.events.filter((e) => e.type === 'rescheduled');
    expect(moved).toHaveLength(3);
    expect(moved[0]).toMatchObject({ reason: 'rollover', to: null, auto: true });
  });

  it('[F-004] rollover on the same day changes nothing and sets no warning', () => {
    const state = stateWith([item({ id: 'y1', scheduledFor: YESTERDAY })]);
    const r = run(state, { type: 'rollover' });
    expect(r.changed).toBe(false);
    expect(r.warning).toBeUndefined();
    expect(r.state).toBe(state);
  });

  it('[F-019] commitEvening moves the picked items to tomorrow with their cues and closes the ritual', () => {
    const state = stateWith([
      item({ id: 'a' }),
      item({ id: 'b', scheduledFor: TODAY }),
      item({ id: 'c' }),
    ]);
    const r = run(state, {
      type: 'commitEvening',
      ids: ['a', 'b', 'missing'],
      cues: { a: 'after breakfast', b: '  ' },
    });
    expect(get(r.state, 'a')).toMatchObject({
      scheduledFor: TOMORROW,
      cue: 'after breakfast',
      rescheduleCount: 0,
    });
    expect(get(r.state, 'b')).toMatchObject({ scheduledFor: TOMORROW, rescheduleCount: 1 });
    expect(get(r.state, 'b').cue).toBeUndefined();
    expect(get(r.state, 'c').scheduledFor).toBeUndefined();
    expect(r.state.day.eveningRitualDone).toBe(true);
    expect(r.events.map((e) => e.type)).toEqual(['committed', 'committed']);
  });
});

describe('reducer: ingest', () => {
  const at = '2026-09-18T07:03:00Z';
  const addCmd = (over: Partial<InboxAddItem> = {}): InboxCommand => ({
    v: 1,
    op: 'add',
    by: 'hermes',
    at,
    item: {
      title: 'Reply to alice',
      dedupeKey: 'issue-1-reply',
      ref: 'https://example.com/issues/1',
      ...over,
    },
  });
  const file = '20260918T070300000Z-issue-1.json';

  it('[F-026] add lands in the Backlog with an agent source and an ingested event', () => {
    const r = run(stateWith([item({ id: 'bl', order: 4 })]), {
      type: 'ingest',
      command: addCmd({ tags: ['mail', 'mail'], suggestedFor: TODAY, estimateMin: 10 }),
      file,
    });
    expect(r.changed).toBe(true);
    expect(r.item).toMatchObject({
      title: 'Reply to alice',
      status: 'open',
      order: 3,
      tags: ['mail'],
      suggestedFor: TODAY,
      estimateMin: 10,
      source: {
        kind: 'agent',
        by: 'hermes',
        ref: 'https://example.com/issues/1',
        dedupeKey: 'issue-1-reply',
      },
    });
    expect(r.item?.scheduledFor).toBeUndefined();
    expect(r.events[0]).toMatchObject({ type: 'ingested', by: 'hermes', itemId: r.item?.id });
  });

  it('[F-026] add with a known dedupeKey is a no-op with warning "duplicate"', () => {
    const first = run(stateWith([]), { type: 'ingest', command: addCmd(), file });
    const again = run(first.state, {
      type: 'ingest',
      command: addCmd({ title: 'Different' }),
      file,
    });
    expect(again.changed).toBe(false);
    expect(again.warning).toBe('duplicate');
    expect(again.state.todos.items).toHaveLength(1);
  });

  it('[F-026] update patches blind fields (ref, suggestedFor, tags union) without baseUpdatedAt', () => {
    const state = stateWith([
      item({ id: 'a', tags: ['mail'], source: { kind: 'agent', by: 'hermes', dedupeKey: 'k' } }),
    ]);
    const cmd: InboxCommand = {
      v: 1,
      op: 'update',
      by: 'hermes',
      at,
      dedupeKey: 'k',
      patch: { tags: ['mail', 'urgent'], suggestedFor: TOMORROW, ref: 'https://example.com/2' },
    };
    const r = run(state, { type: 'ingest', command: cmd, file });
    expect(get(r.state, 'a')).toMatchObject({
      tags: ['mail', 'urgent'],
      suggestedFor: TOMORROW,
      source: { ref: 'https://example.com/2' },
    });
    expect(r.events[0]).toMatchObject({ type: 'edited', by: 'hermes' });
  });

  it('[F-026] update to title/note/cue/due/estimateMin needs a matching baseUpdatedAt', () => {
    const state = stateWith([item({ id: 'a', updatedAt: '2026-09-17T20:00:00+02:00' })]);
    const stale: InboxCommand = {
      v: 1,
      op: 'update',
      by: 'hermes',
      at,
      id: 'a',
      baseUpdatedAt: '2026-09-10T10:00:00+02:00',
      patch: { title: 'New' },
    };
    expect(run(state, { type: 'ingest', command: stale, file }).warning).toBe(
      'stale: item changed at 2026-09-17T20:00:00+02:00',
    );
    const missing: InboxCommand = {
      v: 1,
      op: 'update',
      by: 'hermes',
      at,
      id: 'a',
      patch: { note: 'n' },
    };
    expect(run(state, { type: 'ingest', command: missing, file }).warning).toMatch(
      /^stale: item changed at /,
    );
    const fresh: InboxCommand = {
      v: 1,
      op: 'update',
      by: 'hermes',
      at,
      id: 'a',
      baseUpdatedAt: '2026-09-17T20:00:00+02:00',
      patch: { title: 'New', estimateMin: 20 },
    };
    const r = run(state, { type: 'ingest', command: fresh, file });
    expect(get(r.state, 'a')).toMatchObject({ title: 'New', estimateMin: 20, updatedAt: NOW });
  });

  it('[F-026] update / done report not_found and gone', () => {
    const state = stateWith([
      item({ id: 'a', status: 'dropped', source: { kind: 'agent', dedupeKey: 'k' } }),
    ]);
    const upd: InboxCommand = {
      v: 1,
      op: 'update',
      by: 'hermes',
      at,
      id: 'zz',
      patch: { tags: ['x'] },
    };
    expect(run(state, { type: 'ingest', command: upd, file }).warning).toBe('not_found');
    const gone: InboxCommand = {
      v: 1,
      op: 'update',
      by: 'hermes',
      at,
      dedupeKey: 'k',
      patch: { tags: ['x'] },
    };
    expect(run(state, { type: 'ingest', command: gone, file }).warning).toBe('gone');
    const doneMissing: InboxCommand = {
      v: 1,
      op: 'done',
      by: 'hermes',
      at,
      id: 'zz',
      baseUpdatedAt: NOW,
    };
    expect(run(state, { type: 'ingest', command: doneMissing, file }).warning).toBe('not_found');
  });

  it('[F-026] done needs baseUpdatedAt to match, then completes the item with by=hermes', () => {
    const state = stateWith([item({ id: 'a', updatedAt: '2026-09-17T20:00:00+02:00' })]);
    const stale: InboxCommand = { v: 1, op: 'done', by: 'hermes', at, id: 'a', baseUpdatedAt: NOW };
    expect(run(state, { type: 'ingest', command: stale, file }).warning).toMatch(/^stale/);
    const okCmd: InboxCommand = {
      v: 1,
      op: 'done',
      by: 'hermes',
      at,
      id: 'a',
      baseUpdatedAt: '2026-09-17T20:00:00+02:00',
    };
    const r = run(state, { type: 'ingest', command: okCmd, file });
    expect(get(r.state, 'a')).toMatchObject({ status: 'done', completedAt: NOW });
    expect(r.events[0]).toMatchObject({ type: 'done', by: 'hermes' });
  });

  it('[F-026] ping records a history event and nothing else', () => {
    const state = stateWith([item({ id: 'a' })]);
    const r = run(state, { type: 'ingest', command: { v: 1, op: 'ping', by: 'hermes', at }, file });
    expect(r.events).toEqual([{ ts: NOW, day: TODAY, type: 'ping', by: 'hermes', detail: file }]);
    expect(r.state.todos.items).toEqual(state.todos.items);
  });
});

describe('archive', () => {
  it('[F-030] archives every done non-repeat item, leaves the rest, and records history', () => {
    const doneA = {
      ...item({ id: 'A', title: 'done A' }),
      status: 'done' as const,
      completedAt: '2026-09-18T09:12:00+02:00',
    };
    const openB = item({ id: 'B', title: 'open B' });
    const habit = {
      ...item({ id: 'H', title: 'habit', repeat: 'daily' as const }),
      status: 'open' as const,
    };
    const doneC = {
      ...item({ id: 'C', title: 'done C' }),
      status: 'done' as const,
      completedAt: '2026-09-18T09:12:00+02:00',
    };
    const state = stateWith([doneA, openB, habit, doneC]);
    const r = reduce(state, { type: 'archive' }, clock, settings);
    expect(r.changed).toBe(true);
    expect(r.archived?.map((i) => i.id)).toEqual(['A', 'C']);
    expect(r.state.todos.items.map((i) => i.id)).toEqual(['B', 'H']);
    expect(r.events.filter((e) => e.type === 'archived').map((e) => e.itemId)).toEqual(['A', 'C']);
    expect(state.todos.items).toHaveLength(4); // input untouched
  });

  it('[F-030] archive with ids only takes those items, and refuses items that are not done', () => {
    const doneA = {
      ...item({ id: 'A' }),
      status: 'done' as const,
      completedAt: '2026-09-18T09:12:00+02:00',
    };
    const doneC = {
      ...item({ id: 'C' }),
      status: 'done' as const,
      completedAt: '2026-09-18T09:12:00+02:00',
    };
    const openB = item({ id: 'B' });
    const state = stateWith([doneA, openB, doneC]);
    const one = reduce(state, { type: 'archive', ids: ['C'] }, clock, settings);
    expect(one.archived?.map((i) => i.id)).toEqual(['C']);
    expect(one.state.todos.items.map((i) => i.id)).toEqual(['A', 'B']);
    const refused = reduce(state, { type: 'archive', ids: ['B'] }, clock, settings);
    expect(refused.changed).toBe(false);
    expect(refused.warning).toBe('not done');
    const nothing = reduce(stateWith([openB]), { type: 'archive' }, clock, settings);
    expect(nothing.warning).toBe('nothing to archive');
  });
});
