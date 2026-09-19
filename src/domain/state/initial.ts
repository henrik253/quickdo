import { todayISO, toInstant } from '../time';
import type { Clock, DayState, Schedule, Settings, State, TodosFile } from '../types';

export function emptyTodos(clock: Clock): TodosFile {
  return { version: 1, updatedAt: toInstant(clock), items: [] };
}

export function defaultSchedule(settings: Settings): Schedule {
  return {
    version: 1,
    dayStart: settings.dayStart,
    dayEnd: settings.dayEnd,
    slackMinutes: settings.slackMinutes,
    anchors: [],
  };
}

export function emptyDay(clock: Clock): DayState {
  return { date: todayISO(clock), freshStartAt: null, eveningRitualDone: false };
}

export function emptyState(clock: Clock, settings: Settings): State {
  return { todos: emptyTodos(clock), schedule: defaultSchedule(settings), day: emptyDay(clock) };
}
