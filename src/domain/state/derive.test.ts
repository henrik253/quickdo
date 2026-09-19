import { describe, expect, it } from 'vitest';
import {
  clock,
  clockAt,
  FIXED_NOW,
  item,
  settings,
  stateWith,
  TODAY,
  TOMORROW,
  YESTERDAY,
} from '../testing/fixtures';
import type { HistoryEvent, Item, State } from '../types';
import { derive, repeatDueOn } from './derive';

// Fixture clock: Friday 2026-09-18 09:12 Europe/Berlin (nowMin 552); day 08:00–22:00, slack 90.
// The remaining window is 09:12–22:00 = 768 free minutes.
const FREE = 768;
const SLACK = 90;

function d(state: State, history: HistoryEvent[] = [], c = clock) {
  return derive(state, c, settings, history);
}

function ids(items: Item[]): string[] {
  return items.map((it) => it.id);
}

function ev(over: Partial<HistoryEvent> & Pick<HistoryEvent, 'day'>): HistoryEvent {
  return { ts: `${over.day}T20:00:00+02:00`, type: 'done', ...over };
}

describe('derive: today / backlog / upcoming', () => {
  it('[F-004] splits items into today (dated today, open or skipped), backlog (undated, open) and upcoming', () => {
    const state = stateWith([
      item({ id: 'today-open', scheduledFor: TODAY }),
      item({ id: 'today-skipped', scheduledFor: TODAY, status: 'skipped', skippedOn: TODAY }),
      item({ id: 'today-done', scheduledFor: TODAY, status: 'done', completedAt: FIXED_NOW }),
      item({ id: 'today-dropped', scheduledFor: TODAY, status: 'dropped', droppedAt: FIXED_NOW }),
      item({ id: 'backlog', order: 5 }),
      item({ id: 'backlog-done', status: 'done', completedAt: '2026-09-10T10:00:00+02:00' }),
      item({ id: 'tomorrow', scheduledFor: TOMORROW }),
      item({ id: 'yesterday-open', scheduledFor: YESTERDAY }),
      item({ id: 'habit', repeat: 'daily' }),
      item({ id: 'habit-dated', repeat: 'daily', scheduledFor: TODAY }),
    ]);
    const r = d(state);
    expect(ids(r.today)).toEqual(['today-open', 'today-skipped']);
    expect(ids(r.backlog)).toEqual(['backlog']);
    expect(ids(r.doneToday)).toEqual(['today-done']);
    expect(r.upcoming).toEqual([{ date: TOMORROW, items: [state.todos.items[6]] }]);
    expect(r.habits.map((h) => h.item.id)).toEqual(['habit', 'habit-dated']);
    expect(r.date).toBe(TODAY);
    expect(r.now).toBe('09:12');
  });

  it('[F-009] orders Today by block start, then order, then createdAt; unblocked items last', () => {
    const state = stateWith([
      item({ id: 'late', scheduledFor: TODAY, block: { start: '15:00', minutes: 30 }, order: 1 }),
      item({ id: 'unblocked-b', scheduledFor: TODAY, order: 3 }),
      item({ id: 'early', scheduledFor: TODAY, block: { start: '10:00', minutes: 30 }, order: 9 }),
      item({ id: 'unblocked-a', scheduledFor: TODAY, order: 2 }),
      item({
        id: 'tie-newer',
        scheduledFor: TODAY,
        order: 2,
        createdAt: '2026-09-17T21:00:00+02:00',
      }),
    ]);
    expect(ids(d(state).today)).toEqual([
      'early',
      'late',
      'unblocked-a',
      'tie-newer',
      'unblocked-b',
    ]);
  });

  it('[F-004] orders the Backlog by order ascending, ties by createdAt', () => {
    const state = stateWith([
      item({ id: 'c', order: 3 }),
      item({ id: 'a', order: -1 }),
      item({ id: 'b2', order: 1, createdAt: '2026-09-17T22:00:00+02:00' }),
      item({ id: 'b1', order: 1, createdAt: '2026-09-17T21:00:00+02:00' }),
    ]);
    expect(ids(d(state).backlog)).toEqual(['a', 'b1', 'b2', 'c']);
  });

  it('[F-025] groups upcoming by date for the next 7 days, then "later", skipping done/dropped/habits', () => {
    const state = stateWith([
      item({ id: 'far', scheduledFor: '2026-10-01', order: 2 }),
      item({ id: 'd7', scheduledFor: '2026-09-25' }), // today + 7: still inside the horizon
      item({ id: 'd8', scheduledFor: '2026-09-26', order: 1 }), // today + 8: later
      item({ id: 'tmr-2', scheduledFor: TOMORROW, order: 2 }),
      item({ id: 'tmr-1', scheduledFor: TOMORROW, order: 1 }),
      item({
        id: 'tmr-blocked',
        scheduledFor: TOMORROW,
        order: 9,
        block: { start: '09:00', minutes: 30 },
      }),
      item({ id: 'tmr-done', scheduledFor: TOMORROW, status: 'done', completedAt: FIXED_NOW }),
      item({ id: 'tmr-dropped', scheduledFor: TOMORROW, status: 'dropped' }),
      item({ id: 'tmr-habit', scheduledFor: TOMORROW, repeat: 'weekly:sat' }),
    ]);
    const r = d(state);
    expect(r.upcoming.map((g) => [g.date, ids(g.items)])).toEqual([
      [TOMORROW, ['tmr-blocked', 'tmr-1', 'tmr-2']],
      ['2026-09-25', ['d7']],
      ['later', ['d8', 'far']],
    ]);
  });

  it('[F-025] has no upcoming groups when nothing is dated after today', () => {
    expect(d(stateWith([item({ scheduledFor: TODAY }), item()])).upcoming).toEqual([]);
  });
});

describe('derive: doneToday', () => {
  it('[F-008] keeps items completed on the calendar date in the clock timezone, sorted by completedAt', () => {
    const state = stateWith([
      item({ id: 'later', status: 'done', completedAt: '2026-09-18T08:00:00+02:00' }),
      item({ id: 'just-after-midnight', status: 'done', completedAt: '2026-09-17T22:30:00Z' }),
      item({ id: 'before-midnight', status: 'done', completedAt: '2026-09-17T21:30:00Z' }),
      item({ id: 'no-timestamp', status: 'done' }),
      item({ id: 'habit', status: 'done', repeat: 'daily', completedAt: FIXED_NOW }),
      item({ id: 'open', scheduledFor: TODAY }),
    ]);
    const r = d(state);
    expect(ids(r.doneToday)).toEqual(['just-after-midnight', 'later']);
    expect(ids(r.today)).toEqual(['open']);
  });
});

describe('derive: progress', () => {
  it('[F-008] builds one segment per Today item (done first, then open/skipped) with counts', () => {
    const state = stateWith([
      item({ id: 'open-1', title: 'Read paper X', scheduledFor: TODAY, order: 1 }),
      item({
        id: 'skip',
        title: 'Lecture A notes',
        scheduledFor: TODAY,
        status: 'skipped',
        order: 2,
      }),
      item({ id: 'open-2', title: 'Reply to alice', scheduledFor: TODAY, order: 3 }),
      item({
        id: 'done',
        title: 'Plan week',
        scheduledFor: TODAY,
        status: 'done',
        completedAt: FIXED_NOW,
      }),
      item({ id: 'backlog' }),
      item({ id: 'habit', repeat: 'daily' }),
    ]);
    const p = d(state).progress;
    expect(p).toMatchObject({ done: 1, skipped: 1, open: 2, habitsDone: 0, habitsDue: 1 });
    expect(p.segments).toEqual([
      { id: 'done', title: 'Plan week', status: 'done' },
      { id: 'open-1', title: 'Read paper X', status: 'open' },
      { id: 'skip', title: 'Lecture A notes', status: 'skipped' },
      { id: 'open-2', title: 'Reply to alice', status: 'open' },
    ]);
  });

  it('[F-008] counts habitsDone / habitsDue only over habits due today', () => {
    const state = stateWith([
      item({ id: 'daily', repeat: 'daily' }),
      item({ id: 'weekdays', repeat: 'weekdays' }),
      item({ id: 'sat', repeat: 'weekly:sat' }),
      item({ id: 'fri', repeat: 'weekly:fri' }),
    ]);
    const history = [
      ev({ day: TODAY, itemId: 'fri' }),
      ev({ day: TODAY, itemId: 'sat' }), // not due today: never counted
      ev({ day: YESTERDAY, itemId: 'daily' }),
    ];
    expect(d(state, history).progress).toMatchObject({ habitsDue: 3, habitsDone: 1 });
    expect(d(stateWith([])).progress).toEqual({
      done: 0,
      skipped: 0,
      open: 0,
      segments: [],
      habitsDone: 0,
      habitsDue: 0,
    });
  });
});

describe('derive: capacity', () => {
  function anchor(
    name: string,
    days: State['schedule']['anchors'][number]['days'],
    start: string,
    end: string,
  ) {
    return { name, days, start, end };
  }
  function withAnchors(items: Item[], anchors: State['schedule']['anchors']): State {
    const base = stateWith(items);
    return { ...base, schedule: { ...base.schedule, anchors } };
  }

  it('[F-010] an empty day: free = dayEnd − now, only slack is used, level ok', () => {
    const c = d(stateWith([])).capacity;
    expect(c).toEqual({
      freeMin: FREE,
      busyMin: 0,
      slackMin: SLACK,
      plannedMin: 0,
      remainingMin: FREE - SLACK,
      ratio: SLACK / FREE,
      level: 'ok',
    });
  });

  it("[F-010] [F-012] unions today's anchors with Today blocks — an overlap is never counted twice", () => {
    const state = withAnchors(
      [
        item({ id: 'blocked', scheduledFor: TODAY, block: { start: '11:00', minutes: 120 } }),
        item({ id: 'planned', scheduledFor: TODAY, estimateMin: 30 }),
        item({ id: 'skipped-unblocked', scheduledFor: TODAY, status: 'skipped', estimateMin: 60 }),
        item({ id: 'tomorrow', scheduledFor: TOMORROW, block: { start: '14:00', minutes: 60 } }),
      ],
      [
        anchor('Lecture A', ['fri'], '10:00', '12:00'),
        anchor('Lecture B', ['mon', 'wed'], '10:00', '12:00'),
      ],
    );
    const r = d(state);
    expect(r.busy).toEqual([
      { start: '10:00', end: '12:00', kind: 'anchor', label: 'Lecture A' },
      {
        start: '11:00',
        end: '13:00',
        kind: 'block',
        label: state.todos.items[0].title,
        id: 'blocked',
      },
    ]);
    expect(r.capacity.busyMin).toBe(180); // 10:00–13:00 merged, not 240
    expect(r.capacity.plannedMin).toBe(40); // only the open, unblocked item, padded
    expect(r.capacity.remainingMin).toBe(FREE - 180 - SLACK - 40);
  });

  it('[F-010] only the part of a block inside the remaining window counts', () => {
    const state = stateWith([
      item({ id: 'past', scheduledFor: TODAY, block: { start: '08:00', minutes: 60 } }),
      item({ id: 'straddles-now', scheduledFor: TODAY, block: { start: '09:00', minutes: 60 } }),
      item({ id: 'past-day-end', scheduledFor: TODAY, block: { start: '21:30', minutes: 60 } }),
    ]);
    expect(d(state).capacity.busyMin).toBe(48 + 30); // 09:12–10:00 and 21:30–22:00
  });

  it('[F-015] freshStartAt narrows the window: earlier blocks fall out of busy and free shrinks', () => {
    const base = stateWith([
      item({ id: 'gone', scheduledFor: TODAY, block: { start: '12:00', minutes: 60 } }),
      item({ id: 'straddles', scheduledFor: TODAY, block: { start: '13:30', minutes: 60 } }),
    ]);
    const state: State = { ...base, day: { ...base.day, freshStartAt: '14:00' } };
    const c = d(state).capacity;
    expect(c.freeMin).toBe(22 * 60 - 14 * 60);
    expect(c.busyMin).toBe(30);
    expect(d(base).capacity.busyMin).toBe(120);
  });

  it('[F-010] level is amber from 90 % and red from 100 % of the free window', () => {
    const anchors = [anchor('Training', ['fri'], '12:00', '22:00')]; // 600 busy
    const ok = d(withAnchors([], anchors)).capacity;
    expect(ok.ratio).toBeCloseTo(690 / FREE, 5);
    expect(ok.level).toBe('ok');

    const amber = d(
      withAnchors([item({ scheduledFor: TODAY, estimateMin: 10 })], anchors),
    ).capacity;
    expect(amber.plannedMin).toBe(15);
    expect(amber.ratio).toBeCloseTo(705 / FREE, 5);
    expect(amber.level).toBe('amber');

    const red = d(withAnchors([item({ scheduledFor: TODAY, estimateMin: 60 })], anchors)).capacity;
    expect(red.plannedMin).toBe(80);
    expect(red.remainingMin).toBe(FREE - 770);
    expect(red.level).toBe('red');
  });

  it('[F-010] after dayEnd the free window is empty and everything planned is red', () => {
    const late = clockAt('2026-09-18T22:30:00+02:00');
    const c = derive(stateWith([item({ scheduledFor: TODAY })]), late, settings).capacity;
    expect(c.freeMin).toBe(0);
    expect(c.busyMin).toBe(0);
    expect(c.level).toBe('red');
  });

  it('[F-010] before dayStart the window starts at dayStart', () => {
    const early = clockAt('2026-09-18T06:00:00+02:00');
    const c = derive(stateWith([]), early, settings).capacity;
    expect(c.freeMin).toBe(14 * 60);
  });
});

describe('derive: habits', () => {
  it('[F-018] repeatDueOn follows the weekday of the date', () => {
    expect(repeatDueOn('daily', '2026-09-19')).toBe(true);
    expect(repeatDueOn('weekdays', '2026-09-18')).toBe(true); // Friday
    expect(repeatDueOn('weekdays', '2026-09-19')).toBe(false); // Saturday
    expect(repeatDueOn('weekdays', '2026-09-20')).toBe(false); // Sunday
    expect(repeatDueOn('weekly:fri', '2026-09-18')).toBe(true);
    expect(repeatDueOn('weekly:sat', '2026-09-18')).toBe(false);
  });

  it('[F-018] dueToday, doneToday, done7/due7 and missedYesterday come from done history events', () => {
    const state = stateWith([
      item({ id: 'daily', repeat: 'daily', createdAt: '2026-09-10T08:00:00+02:00', order: 1 }),
      item({
        id: 'weekdays',
        repeat: 'weekdays',
        createdAt: '2026-09-15T08:00:00+02:00',
        order: 2,
      }),
      item({ id: 'sat', repeat: 'weekly:sat', createdAt: '2026-09-01T08:00:00+02:00', order: 3 }),
      item({ id: 'fri', repeat: 'weekly:fri', createdAt: '2026-09-01T08:00:00+02:00', order: 4 }),
      item({ id: 'new', repeat: 'daily', createdAt: FIXED_NOW, order: 5 }),
      item({ id: 'done-habit', repeat: 'daily', status: 'done', order: 6 }),
      item({ id: 'dropped-habit', repeat: 'daily', status: 'dropped', order: 7 }),
    ]);
    const history: HistoryEvent[] = [
      ev({ day: '2026-09-17', itemId: 'daily' }),
      ev({ day: '2026-09-15', itemId: 'daily' }),
      ev({ day: '2026-09-13', itemId: 'daily' }),
      ev({ day: '2026-09-13', itemId: 'daily' }), // same day twice counts once
      ev({ day: '2026-09-14', itemId: 'daily', type: 'skipped' }), // not a done
      ev({ day: '2026-09-16', itemId: 'weekdays', type: 'started' }),
      ev({ day: '2026-09-16', itemId: 'other-item' }),
      ev({ day: TODAY, itemId: 'fri' }),
      ev({ day: '2026-09-12', itemId: 'sat' }),
      ev({ day: TODAY }), // no itemId: ignored
    ];
    const habits = d(state, history).habits;
    expect(habits.map((h) => h.item.id)).toEqual(['daily', 'weekdays', 'sat', 'fri', 'new']);
    const byId = Object.fromEntries(habits.map((h) => [h.item.id, h]));
    expect(byId.daily).toMatchObject({
      dueToday: true,
      doneToday: false,
      done7: 3,
      due7: 7,
      missedYesterday: false,
    });
    // created on Tue 09-15: due days before today are Thu, Wed, Tue → 3, none done → missed yesterday
    expect(byId.weekdays).toMatchObject({
      dueToday: true,
      doneToday: false,
      done7: 0,
      due7: 3,
      missedYesterday: true,
    });
    // Saturdays since 09-01: 09-12 and 09-05; not due today or yesterday
    expect(byId.sat).toMatchObject({
      dueToday: false,
      doneToday: false,
      done7: 1,
      due7: 2,
      missedYesterday: false,
    });
    expect(byId.fri).toMatchObject({ dueToday: true, doneToday: true, done7: 0, due7: 2 });
    // created today: no history window yet, and a missing yesterday is not a miss
    expect(byId.new).toMatchObject({ dueToday: true, done7: 0, due7: 0, missedYesterday: false });
  });

  it('[F-018] a daily habit missed yesterday is flagged, and only yesterday counts', () => {
    const state = stateWith([
      item({ id: 'h', repeat: 'daily', createdAt: '2026-09-01T08:00:00+02:00' }),
    ]);
    expect(d(state, []).habits[0].missedYesterday).toBe(true);
    expect(d(state, [ev({ day: '2026-09-16', itemId: 'h' })]).habits[0].missedYesterday).toBe(true);
    expect(d(state, [ev({ day: YESTERDAY, itemId: 'h' })]).habits[0]).toMatchObject({
      missedYesterday: false,
      done7: 1,
      due7: 7,
    });
  });

  it('[F-018] a weekly habit whose last due day was done is not missed on the day after', () => {
    // Saturday 2026-09-19 09:00: a weekly:fri habit was due yesterday
    const sat = clockAt('2026-09-19T09:00:00+02:00');
    const state = stateWith([
      item({ id: 'h', repeat: 'weekly:fri', createdAt: '2026-09-01T08:00:00+02:00' }),
    ]);
    const done = derive(state, sat, settings, [ev({ day: '2026-09-18', itemId: 'h' })]).habits[0];
    // Fridays since 09-01: 09-04, 09-11, 09-18
    expect(done).toMatchObject({ dueToday: false, missedYesterday: false, done7: 1, due7: 3 });
    const missed = derive(state, sat, settings, []).habits[0];
    expect(missed.missedYesterday).toBe(true);
  });
});

describe('derive: slips', () => {
  const grace = settings.slipGraceMin; // 10; now is 09:12

  it('[F-013] notStarted: block start + grace is past and the item was never started', () => {
    const state = stateWith([
      item({ id: 'slipped', scheduledFor: TODAY, block: { start: '09:00', minutes: 30 } }),
      item({ id: 'on-the-edge', scheduledFor: TODAY, block: { start: '09:02', minutes: 30 } }),
      item({ id: 'future', scheduledFor: TODAY, block: { start: '10:00', minutes: 30 } }),
      item({ id: 'unblocked', scheduledFor: TODAY }),
      item({
        id: 'skipped',
        scheduledFor: TODAY,
        status: 'skipped',
        block: { start: '08:00', minutes: 30 },
      }),
      item({ id: 'other-day', scheduledFor: TOMORROW, block: { start: '08:00', minutes: 30 } }),
    ]);
    expect(grace).toBe(10);
    expect(d(state).slips).toEqual([{ id: 'slipped', kind: 'notStarted' }]);
  });

  it('[F-013] overran: block end + grace is past and the item was started', () => {
    const state = stateWith([
      item({
        id: 'overran',
        scheduledFor: TODAY,
        block: { start: '08:00', minutes: 60 },
        startedAt: '2026-09-18T08:00:00+02:00',
      }),
      item({
        id: 'still-fine',
        scheduledFor: TODAY,
        block: { start: '08:45', minutes: 30 },
        startedAt: '2026-09-18T08:45:00+02:00',
      }),
      item({
        id: 'started-late-not-a-slip',
        scheduledFor: TODAY,
        block: { start: '08:30', minutes: 60 },
        startedAt: '2026-09-18T09:00:00+02:00',
      }),
    ]);
    expect(d(state).slips).toEqual([{ id: 'overran', kind: 'overran' }]);
  });

  it('[F-015] a fresh start masks notStarted slips of blocks that began before it, not later ones', () => {
    const base = stateWith([
      item({ id: 'before', scheduledFor: TODAY, block: { start: '08:30', minutes: 20 } }),
      item({ id: 'after', scheduledFor: TODAY, block: { start: '09:00', minutes: 20 } }),
      item({
        id: 'overran',
        scheduledFor: TODAY,
        block: { start: '08:00', minutes: 30 },
        startedAt: '2026-09-18T08:00:00+02:00',
      }),
    ]);
    expect(
      d(base)
        .slips.map((s) => s.id)
        .sort(),
    ).toEqual(['after', 'before', 'overran']);
    const fresh: State = { ...base, day: { ...base.day, freshStartAt: '08:45' } };
    expect(d(fresh).slips).toEqual([
      { id: 'overran', kind: 'overran' },
      { id: 'after', kind: 'notStarted' },
    ]);
  });
});

describe('derive: overCap and padded', () => {
  it('[F-005] overCap flips at todayCap + 1 open/skipped Today items; done items and habits do not count', () => {
    const five = Array.from({ length: settings.todayCap }, (_, i) =>
      item({ id: `t${i}`, scheduledFor: TODAY, status: i === 0 ? 'skipped' : 'open' }),
    );
    const extras = [
      item({ id: 'done', scheduledFor: TODAY, status: 'done', completedAt: FIXED_NOW }),
      item({ id: 'habit', repeat: 'daily' }),
      item({ id: 'backlog' }),
    ];
    expect(settings.todayCap).toBe(5);
    expect(d(stateWith([...five, ...extras])).overCap).toBe(false);
    expect(
      d(stateWith([...five, ...extras, item({ id: 't6', scheduledFor: TODAY })])).overCap,
    ).toBe(true);
  });

  it('[F-006] padded maps every non-dropped item to ceil((estimate ?? default) × 1.3 / 5) × 5', () => {
    const state = stateWith([
      item({ id: 'thirty', estimateMin: 30, scheduledFor: TODAY }),
      item({ id: 'default' }),
      item({ id: 'ten', estimateMin: 10, status: 'done', completedAt: FIXED_NOW }),
      item({ id: 'ninety', estimateMin: 90, scheduledFor: TOMORROW }),
      item({ id: 'zero', estimateMin: 0 }),
      item({ id: 'dropped', estimateMin: 30, status: 'dropped' }),
    ]);
    expect(d(state).padded).toEqual({ thirty: 40, default: 40, ten: 15, ninety: 120, zero: 0 });
  });
});
