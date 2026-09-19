/**
 * The derived read model (docs/CONTRACTS.md §1 derive rules). Pure and never stored.
 */
import type {
  Clock,
  Derived,
  HabitView,
  HistoryEvent,
  ISODate,
  Item,
  Repeat,
  Settings,
  State,
  Weekday,
} from '../types';
import { blockEnd, busyFor, busyMinutesWithin } from '../plan/busy';
import { addDays, dateOf, hhmmToMin, nowHHMM, padded, todayISO, weekdayOf } from '../time';

const WEEKEND: readonly Weekday[] = ['sat', 'sun'];

/** Is a repeat rule due on `date`? */
export function repeatDueOn(repeat: Repeat, date: ISODate): boolean {
  const wd = weekdayOf(date);
  if (repeat === 'daily') return true;
  if (repeat === 'weekdays') return !WEEKEND.includes(wd);
  return repeat === `weekly:${wd}`;
}

function byBlockThenOrder(a: Item, b: Item): number {
  const as = a.block ? hhmmToMin(a.block.start) : Number.POSITIVE_INFINITY;
  const bs = b.block ? hhmmToMin(b.block.start) : Number.POSITIVE_INFINITY;
  return as - bs || a.order - b.order || a.createdAt.localeCompare(b.createdAt);
}

function byOrder(a: Item, b: Item): number {
  return a.order - b.order || a.createdAt.localeCompare(b.createdAt);
}

function habitView(item: Item, date: ISODate, doneDays: Set<string>, tz: string): HabitView {
  const repeat = item.repeat as Repeat;
  const created = dateOf(item.createdAt, tz);
  const yesterday = addDays(date, -1);
  let due7 = 0;
  let done7 = 0;
  // the last 7 due days before today, not earlier than the habit exists
  for (let d = yesterday, guard = 0; due7 < 7 && guard < 70 && d >= created; d = addDays(d, -1), guard++) {
    if (!repeatDueOn(repeat, d)) continue;
    due7 += 1;
    if (doneDays.has(d)) done7 += 1;
  }
  const dueYesterday = yesterday >= created && repeatDueOn(repeat, yesterday);
  return {
    item,
    dueToday: repeatDueOn(repeat, date),
    doneToday: doneDays.has(date),
    done7,
    due7,
    missedYesterday: dueYesterday && !doneDays.has(yesterday),
  };
}

export function derive(
  state: State,
  clock: Clock,
  settings: Settings,
  history: HistoryEvent[] = [],
): Derived {
  const date = todayISO(clock);
  const now = nowHHMM(clock);
  const nowMin = hhmmToMin(now);
  const items = state.todos.items;
  const tz = clock.tz;

  const today = items
    .filter(
      (it) =>
        it.repeat === undefined &&
        it.scheduledFor === date &&
        (it.status === 'open' || it.status === 'skipped'),
    )
    .sort(byBlockThenOrder);
  const doneToday = items
    .filter(
      (it) =>
        it.repeat === undefined &&
        it.status === 'done' &&
        it.completedAt !== undefined &&
        dateOf(it.completedAt, tz) === date,
    )
    .sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? ''));

  const doneDaysByItem = new Map<string, Set<string>>();
  for (const ev of history) {
    if (ev.type !== 'done' || !ev.itemId) continue;
    let set = doneDaysByItem.get(ev.itemId);
    if (!set) {
      set = new Set();
      doneDaysByItem.set(ev.itemId, set);
    }
    set.add(ev.day);
  }
  const habits = items
    .filter((it) => it.repeat !== undefined && it.status === 'open')
    .sort(byOrder)
    .map((it) => habitView(it, date, doneDaysByItem.get(it.id) ?? new Set(), tz));

  const backlog = items
    .filter((it) => it.status === 'open' && it.scheduledFor === undefined && it.repeat === undefined)
    .sort(byOrder);

  const horizon = addDays(date, 7);
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    if (it.status !== 'open' || it.repeat !== undefined || !it.scheduledFor || it.scheduledFor <= date) {
      continue;
    }
    const key = it.scheduledFor <= horizon ? it.scheduledFor : 'later';
    const list = groups.get(key) ?? [];
    list.push(it);
    groups.set(key, list);
  }
  const upcoming: Derived['upcoming'] = [...groups.entries()]
    .sort(([a], [b]) => (a === 'later' ? 1 : b === 'later' ? -1 : a.localeCompare(b)))
    .map(([d, list]) => ({ date: d as ISODate | 'later', items: list.sort(byBlockThenOrder) }));

  const paddedMap: Record<string, number> = {};
  for (const it of items) {
    if (it.status !== 'dropped') paddedMap[it.id] = padded(it.estimateMin, settings);
  }

  const habitsDue = habits.filter((h) => h.dueToday);
  const progress: Derived['progress'] = {
    done: doneToday.length,
    skipped: today.filter((it) => it.status === 'skipped').length,
    open: today.filter((it) => it.status === 'open').length,
    segments: [
      ...doneToday.map((it) => ({ id: it.id, title: it.title, status: 'done' as const })),
      ...today.map((it) => ({
        id: it.id,
        title: it.title,
        status: it.status === 'skipped' ? ('skipped' as const) : ('open' as const),
      })),
    ],
    habitsDone: habitsDue.filter((h) => h.doneToday).length,
    habitsDue: habitsDue.length,
  };

  const busy = busyFor(state, date);
  const dayStartMin = hhmmToMin(state.schedule.dayStart);
  const dayEndMin = hhmmToMin(state.schedule.dayEnd);
  const freshMin = state.day.freshStartAt ? hhmmToMin(state.day.freshStartAt) : 0;
  const windowStart = Math.max(nowMin, dayStartMin, freshMin);
  const freeMin = Math.max(0, dayEndMin - windowStart);
  const busyMin = busyMinutesWithin(busy, windowStart, dayEndMin);
  const slackMin = state.schedule.slackMinutes;
  const plannedMin = today
    .filter((it) => it.status === 'open' && !it.block)
    .reduce((sum, it) => sum + paddedMap[it.id], 0);
  const used = busyMin + slackMin + plannedMin;
  const ratio = used / Math.max(freeMin, 1);
  const level: Derived['capacity']['level'] = ratio >= 1 ? 'red' : ratio >= 0.9 ? 'amber' : 'ok';
  const capacity: Derived['capacity'] = {
    freeMin,
    busyMin,
    slackMin,
    plannedMin,
    remainingMin: freeMin - used,
    ratio,
    level,
  };

  const grace = settings.slipGraceMin;
  const slips: Derived['slips'] = [];
  for (const it of today) {
    if (it.status !== 'open' || !it.block) continue;
    const startMin = hhmmToMin(it.block.start);
    const endMin = hhmmToMin(blockEnd(it.block));
    const masked = state.day.freshStartAt !== null && startMin < freshMin;
    if (!it.startedAt && startMin + grace < nowMin && !masked) slips.push({ id: it.id, kind: 'notStarted' });
    else if (it.startedAt && endMin + grace < nowMin) slips.push({ id: it.id, kind: 'overran' });
  }

  return {
    date,
    now,
    today,
    doneToday,
    habits,
    backlog,
    upcoming,
    progress,
    capacity,
    overCap: today.length > settings.todayCap,
    padded: paddedMap,
    slips,
    busy,
  };
}
