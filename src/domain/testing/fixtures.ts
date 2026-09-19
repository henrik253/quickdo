/**
 * Pure test fixtures shared by the domain tests (no I/O). The fake clock is fixed at
 * Friday 2026-09-18 09:12 Europe/Berlin; DEFAULT_SETTINGS apply.
 */

import { emptyState } from '../state/initial';
import type { Clock, Item, ParsedCapture, Settings, State } from '../types';
import { DEFAULT_SETTINGS } from '../types';

export const FIXED_NOW = '2026-09-18T09:12:00+02:00';
export const TODAY = '2026-09-18';
export const TOMORROW = '2026-09-19';
export const YESTERDAY = '2026-09-17';

export const clock: Clock = { now: () => new Date(FIXED_NOW), tz: 'Europe/Berlin' };
export const settings: Settings = DEFAULT_SETTINGS;

export function clockAt(iso: string, tz = 'Europe/Berlin'): Clock {
  return { now: () => new Date(iso), tz };
}

let seq = 0;

export function item(over: Partial<Item> = {}): Item {
  seq += 1;
  const id = over.id ?? `01ITEM${String(seq).padStart(20, '0')}`;
  return {
    id,
    title: `Read paper X ${seq}`,
    status: 'open',
    tags: [],
    rescheduleCount: 0,
    order: seq,
    source: { kind: 'ui' },
    createdAt: '2026-09-17T20:00:00+02:00',
    updatedAt: '2026-09-17T20:00:00+02:00',
    ...over,
  };
}

export function stateWith(items: Item[], over: Partial<State> = {}): State {
  const base = emptyState(clock, settings);
  return { ...base, todos: { ...base.todos, items }, ...over };
}

export function parsed(over: Partial<ParsedCapture> = {}): ParsedCapture {
  return { title: 'Read paper X', tags: [], tokens: [], warnings: [], ...over };
}
