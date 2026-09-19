/**
 * Component-test helpers: a StateResponse builder on top of the domain fixtures (fixed clock
 * Friday 2026-09-18 09:12 Europe/Berlin), a fetch mock and a fake EventSource. Synthetic data only.
 */
import { vi } from 'vitest';
import { derive } from '../../domain/state/derive';
import { clock, item, settings, stateWith } from '../../domain/testing/fixtures';
import type { HistoryEvent, Item, State } from '../../domain/types';
import type { SyncStatus } from '../../server/sync/types';
import type { StateResponse } from '../api';
import { resetStore, useStore } from '../store';

export { clock, item, settings, TODAY, TOMORROW, YESTERDAY } from '../../domain/testing/fixtures';

export const SYNC_OK: SyncStatus = {
  enabled: true,
  lastSync: '2026-09-18T09:10:00+02:00',
  lastPush: '2026-09-18T09:10:00+02:00',
  remoteSha: 'abc',
  pending: 0,
  offline: false,
  conflict: null,
  hermesLastSeen: null,
  rejectedCount: 0,
  lastError: null,
  cycles: 3,
};

export function makeState(
  items: Item[] = [],
  over: Partial<StateResponse> & { state?: Partial<State>; history?: HistoryEvent[] } = {},
): StateResponse {
  const domain = stateWith(items, over.state ?? {});
  const derived = derive(domain, clock, settings, over.history ?? []);
  const { state: _s, history: _h, ...rest } = over;
  return {
    items: domain.todos.items,
    schedule: domain.schedule,
    day: domain.day,
    derived,
    settings,
    sync: SYNC_OK,
    version: { app: '0.1.0', gitSha: null, buildSha: 'test' },
    rolloverCount: 0,
    problems: [],
    ...rest,
  };
}

/** A Today item (scheduled today). */
export function todayItem(over: Partial<Item> = {}): Item {
  return item({ scheduledFor: '2026-09-18', ...over });
}

/** Seed the store with a state as if it had arrived over SSE. */
export function seedStore(state: StateResponse): void {
  resetStore();
  useStore.getState().applyState(state);
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** Install a fetch mock; returns the spy so tests can inspect calls. */
export function mockFetch(handler: FetchHandler) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

export function bodyOf(call: [RequestInfo | URL, RequestInit?]): Record<string, unknown> {
  return JSON.parse(String(call[1]?.body ?? '{}')) as Record<string, unknown>;
}

type Listener = (ev: MessageEvent) => void;

export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  url: string;
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  listeners = new Map<string, Listener[]>();
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((f) => f !== fn),
    );
  }
  close() {
    this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  fail() {
    this.onerror?.(new Event('error'));
  }
  emit(type: string, data: unknown) {
    const ev = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
  static last(): FakeEventSource {
    const es = FakeEventSource.instances[FakeEventSource.instances.length - 1];
    if (!es) throw new Error('no EventSource was created');
    return es;
  }
}

export function installFakeEventSource(): void {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
}
