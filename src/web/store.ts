/**
 * The zustand store (docs/CONTRACTS.md §4). `EventSource('/api/events')` feeds `state`; every
 * mutation is applied optimistically through the shared domain reducer and replaced by the next
 * `state` event; failures show a chip and keep the capture draft in localStorage.
 */
import { TZDate } from '@date-fns/tz';
import { create } from 'zustand';
import { parseCapture } from '../domain/capture/parseCapture';
import { derive } from '../domain/state/derive';
import { reduce } from '../domain/state/reducer';
import { addDays, padded } from '../domain/time';
import type {
  Action,
  CaptureTarget,
  Clock,
  EditablePatch,
  HHMM,
  Item,
  State,
} from '../domain/types';
import type { SyncStatus } from '../server/sync/types';
import { api, type ItemAction, type StateResponse } from './api';
import type { InlineKind, Mode, RowAction } from './focus';

export type View = 'backlog' | 'upcoming';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'warn';
}

export interface Inline {
  id: string;
  kind: InlineKind;
}

export const DRAFT_KEY = 'quickdo.draft';
export const LAST_CAPTURE_KEY = 'quickdo.lastCapture';

export interface Store {
  state: StateResponse | null;
  /** Instant (ms) the current `state` arrived; drives the client clock for optimistic updates. */
  receivedAt: number;
  connected: boolean;
  toast: Toast[];
  draft: string;
  lastCapture: string | null;
  mode: Mode;
  cursor: string | null;
  view: View;
  filter: string;
  pendingChord: 'g' | null;
  inline: Inline | null;
  helpOpen: boolean;
  updatePending: boolean;
  /** Rows that just appeared (flash), item ids. */
  flash: string[];

  applyState(next: StateResponse): void;
  applySync(sync: SyncStatus): void;
  setConnected(connected: boolean): void;
  showToast(text: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
  setDraft(text: string): void;
  setMode(mode: Mode): void;
  setCursor(id: string | null): void;
  moveCursor(delta: 1 | -1): void;
  setView(view: View): void;
  toggleView(): void;
  setFilter(filter: string): void;
  setPendingChord(key: 'g' | null): void;
  setInline(inline: Inline | null): void;
  setHelpOpen(open: boolean): void;
  setUpdatePending(pending: boolean): void;

  capture(text: string, target?: CaptureTarget): Promise<boolean>;
  rowAction(id: string, action: RowAction): Promise<void>;
  patch(id: string, patch: EditablePatch): Promise<void>;
  shiftBlock(id: string, minutes: number): Promise<void>;
  freshStart(): Promise<void>;
  forceSync(): Promise<void>;
  connect(): void;
  disconnect(): void;
}

let toastSeq = 0;
let source: EventSource | null = null;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable (private window): the draft simply lives in memory
  }
}

/** A clock anchored at the server's `derived.date`/`derived.now`, advancing with the wall clock. */
export function clockOf(state: StateResponse, receivedAt: number): Clock {
  const tz = state.settings.timezone;
  const [y, m, d] = state.derived.date.split('-').map(Number);
  const [hh, mm] = state.derived.now.split(':').map(Number);
  const base = new TZDate(y, m - 1, d, hh, mm, 0, tz).getTime();
  return { now: () => new Date(base + (Date.now() - receivedAt)), tz };
}

function domainState(s: StateResponse): State {
  return {
    todos: { version: 1, updatedAt: s.derived.date, items: s.items },
    schedule: s.schedule,
    day: s.day,
  };
}

/** Run the shared reducer on the local copy and re-derive; `null` when the precondition failed. */
function optimistic(
  s: StateResponse,
  receivedAt: number,
  action: Action,
): { next: StateResponse; warning?: string } {
  const clock = clockOf(s, receivedAt);
  const result = reduce(domainState(s), action, clock, s.settings);
  if (!result.changed) return { next: s, warning: result.warning };
  const derived = derive(result.state, clock, s.settings);
  // History is server-side; keep the habit views (done today, 5 of 7) from the last server state.
  const habits = s.derived.habits.map((h) => ({
    ...h,
    item: result.state.todos.items.find((it) => it.id === h.item.id) ?? h.item,
  }));
  return {
    next: {
      ...s,
      items: result.state.todos.items,
      day: result.state.day,
      derived: {
        ...derived,
        habits,
        progress: {
          ...derived.progress,
          habitsDone: s.derived.progress.habitsDone,
          habitsDue: s.derived.progress.habitsDue,
        },
      },
    },
  };
}

/** Rows in cursor order: Today (open + skipped), done today, habits, then Backlog or Upcoming. */
export function visibleRows(state: StateResponse | null, view: View, filter: string): Item[] {
  if (!state) return [];
  const d = state.derived;
  const q = filter.trim().toLowerCase();
  const matches = (it: Item) =>
    !q ||
    it.title.toLowerCase().includes(q) ||
    (it.project ?? '').toLowerCase().includes(q) ||
    it.tags.some((t) => t.toLowerCase().includes(q));
  const lower = view === 'backlog' ? d.backlog : d.upcoming.flatMap((g) => g.items);
  return [...d.today, ...d.doneToday, ...d.habits.map((h) => h.item), ...lower.filter(matches)];
}

function rowActionToDomain(
  s: StateResponse,
  id: string,
  action: RowAction,
): { domain: Action; api: ItemAction | null; body?: { minutes?: number }; patch?: EditablePatch } {
  const today = s.derived.date;
  switch (action) {
    case 'done':
      return { domain: { type: 'done', id }, api: 'done' };
    case 'undo':
      return { domain: { type: 'undo', id }, api: 'undo' };
    case 'skip':
      return { domain: { type: 'skip', id }, api: 'skip' };
    case 'drop':
      return { domain: { type: 'drop', id }, api: 'drop' };
    case 'start':
    case 'twoMinute':
      return { domain: { type: 'start', id }, api: 'start' };
    case 'extend':
      return { domain: { type: 'extend', id, minutes: 15 }, api: 'extend', body: { minutes: 15 } };
    case 'today':
      return { domain: { type: 'reschedule', id, to: today }, api: 'today' };
    case 'tomorrow':
      return { domain: { type: 'reschedule', id, to: addDays(today, 1) }, api: 'tomorrow' };
    case 'backlog':
      return { domain: { type: 'reschedule', id, to: null }, api: 'backlog' };
    case 'next':
      return { domain: { type: 'nextSlot', id }, api: 'next' };
    case 'accept':
      return { domain: { type: 'accept', id }, api: 'accept' };
    case 'fallback': {
      // Stored fallback or the derived "15 min at 16:00" (docs/PLAN.md F-016), applied as a block.
      const item = s.items.find((it) => it.id === id);
      const block = {
        start: (item?.fallback?.at ?? '16:00') as HHMM,
        minutes: item?.fallback?.minutes ?? 15,
      };
      return {
        domain: { type: 'setBlock', id, start: block.start, minutes: block.minutes },
        api: null,
        patch: { block },
      };
    }
  }
}

export const useStore = create<Store>()((set, get) => ({
  state: null,
  receivedAt: Date.now(),
  connected: false,
  toast: [],
  draft: readStorage(DRAFT_KEY) ?? '',
  lastCapture: readStorage(LAST_CAPTURE_KEY),
  mode: 'capture',
  cursor: null,
  view: 'backlog',
  filter: '',
  pendingChord: null,
  inline: null,
  helpOpen: false,
  updatePending: false,
  flash: [],

  applyState(next) {
    const prev = get().state;
    const cursor = get().cursor;
    const stillThere = cursor !== null && next.items.some((it) => it.id === cursor);
    const flash =
      prev === null
        ? []
        : next.items.filter((it) => !prev.items.some((p) => p.id === it.id)).map((it) => it.id);
    set({ state: next, receivedAt: Date.now(), cursor: stillThere ? cursor : null, flash });
    if (flash.length) setTimeout(() => set({ flash: [] }), 1200);
  },
  applySync(sync) {
    const s = get().state;
    if (s) set({ state: { ...s, sync } });
  },
  setConnected(connected) {
    set({ connected });
  },
  showToast(text, kind = 'info') {
    const id = ++toastSeq;
    set({ toast: [...get().toast, { id, text, kind }] });
    setTimeout(() => get().dismissToast(id), kind === 'warn' ? 8000 : 4000);
  },
  dismissToast(id) {
    set({ toast: get().toast.filter((t) => t.id !== id) });
  },
  setDraft(text) {
    set({ draft: text });
    writeStorage(DRAFT_KEY, text ? text : null);
    const trimmed = text.trimStart();
    set({ filter: trimmed.startsWith('?') ? trimmed.slice(1).trim() : '' });
  },
  setMode(mode) {
    set({ mode, pendingChord: null });
    if (mode === 'list' && get().cursor === null) {
      const rows = visibleRows(get().state, get().view, get().filter);
      set({ cursor: rows[0]?.id ?? null });
    }
  },
  setCursor(id) {
    set({ cursor: id });
  },
  moveCursor(delta) {
    const rows = visibleRows(get().state, get().view, get().filter);
    if (rows.length === 0) return;
    const idx = rows.findIndex((it) => it.id === get().cursor);
    const nextIdx =
      idx < 0
        ? delta > 0
          ? 0
          : rows.length - 1
        : Math.min(rows.length - 1, Math.max(0, idx + delta));
    set({ cursor: rows[nextIdx].id });
  },
  setView(view) {
    set({ view });
  },
  toggleView() {
    set({ view: get().view === 'backlog' ? 'upcoming' : 'backlog' });
  },
  setFilter(filter) {
    set({ filter });
  },
  setPendingChord(key) {
    set({ pendingChord: key });
  },
  setInline(inline) {
    set({ inline });
  },
  setHelpOpen(open) {
    set({ helpOpen: open });
  },
  setUpdatePending(pending) {
    set({ updatePending: pending });
  },

  async capture(text, target) {
    const s = get().state;
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (s) {
      const clock = clockOf(s, get().receivedAt);
      const parsed = parseCapture(trimmed, clock, s.settings);
      if (parsed.filter !== undefined) return false;
      const { next, warning } = optimistic(s, get().receivedAt, {
        type: 'add',
        parsed,
        source: { kind: 'ui' },
        target,
      });
      if (warning) {
        get().showToast(warning, 'warn');
        return false;
      }
      set({ state: next });
      for (const w of parsed.warnings) get().showToast(w, 'warn');
    }
    set({ draft: '', lastCapture: trimmed, filter: '' });
    writeStorage(DRAFT_KEY, null);
    writeStorage(LAST_CAPTURE_KEY, trimmed);
    try {
      const res = await api.capture(trimmed, target, 'ui');
      get().applyState(res.state);
      return true;
    } catch (err) {
      // keep the draft so nothing is lost
      set({ draft: trimmed });
      writeStorage(DRAFT_KEY, trimmed);
      if (s) set({ state: s });
      get().showToast(`capture failed — draft kept (${(err as Error).message})`, 'warn');
      return false;
    }
  },

  async rowAction(id, action) {
    const s = get().state;
    if (!s) return;
    const mapped = rowActionToDomain(s, id, action);
    const { next, warning } = optimistic(s, get().receivedAt, mapped.domain);
    if (warning) {
      get().showToast(warning, 'warn');
      return;
    }
    set({ state: next });
    if (action === 'skip')
      get().showToast('Skipped. One miss changes nothing; the next block is what counts.');
    if (action === 'twoMinute') get().showToast('two minutes — just start');
    try {
      const res = mapped.api
        ? await api.itemAction(id, mapped.api, mapped.body)
        : await api.patchItem(id, mapped.patch ?? {});
      get().applyState(res.state);
    } catch (err) {
      set({ state: s });
      get().showToast(`${action} failed: ${(err as Error).message}`, 'warn');
    }
  },

  async patch(id, patch) {
    const s = get().state;
    if (!s) return;
    const { next, warning } = optimistic(s, get().receivedAt, { type: 'edit', id, patch });
    if (warning) {
      get().showToast(warning, 'warn');
      return;
    }
    set({ state: next });
    try {
      const res = await api.patchItem(id, patch);
      get().applyState(res.state);
    } catch (err) {
      set({ state: s });
      get().showToast(`edit failed: ${(err as Error).message}`, 'warn');
    }
  },

  async shiftBlock(id, minutes) {
    const s = get().state;
    if (!s) return;
    const { next, warning } = optimistic(s, get().receivedAt, { type: 'shiftBlock', id, minutes });
    if (warning) {
      get().showToast(warning, 'warn');
      return;
    }
    const block = next.items.find((it) => it.id === id)?.block;
    if (!block) return;
    set({ state: next });
    try {
      const res = await api.patchItem(id, { block });
      get().applyState(res.state);
    } catch (err) {
      set({ state: s });
      get().showToast(`shift failed: ${(err as Error).message}`, 'warn');
    }
  },

  async freshStart() {
    const s = get().state;
    if (!s) return;
    const { next } = optimistic(s, get().receivedAt, { type: 'freshStart' });
    set({ state: next });
    get().showToast('fresh start — past-due blocks cleared, the rest of the day is yours');
    try {
      const res = await api.freshStart();
      get().applyState(res.state);
    } catch (err) {
      set({ state: s });
      get().showToast(`fresh start failed: ${(err as Error).message}`, 'warn');
    }
  },

  async forceSync() {
    try {
      const res = await api.sync();
      get().applySync(res.sync);
      get().showToast('sync done');
    } catch (err) {
      get().showToast(`sync failed: ${(err as Error).message}`, 'warn');
    }
  },

  connect() {
    if (source) source.close();
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/events');
    source = es;
    es.onopen = () => get().setConnected(true);
    es.onerror = () => get().setConnected(false);
    es.addEventListener('state', (ev) => {
      get().applyState(JSON.parse((ev as MessageEvent).data) as StateResponse);
      get().setConnected(true);
    });
    es.addEventListener('sync', (ev) => {
      get().applySync(JSON.parse((ev as MessageEvent).data) as SyncStatus);
    });
    es.addEventListener('agent', (ev) => {
      const payload = JSON.parse((ev as MessageEvent).data) as {
        added?: Item[];
        changed?: Array<{ id: string; field: string }>;
      };
      const n = payload.added?.length ?? 0;
      const c = payload.changed?.length ?? 0;
      if (n > 0) get().showToast(`Hermes added ${n}`);
      else if (c > 0) get().showToast(`Hermes changed ${c}`);
    });
    es.addEventListener('update', () => get().setUpdatePending(true));
  },
  disconnect() {
    if (source) source.close();
    source = null;
    set({ connected: false });
  },
}));

/** Is the SSE stream closed (so a health-poll success should reconnect)? */
export function sourceClosed(): boolean {
  return source === null || source.readyState === 2;
}

/** Padded minutes for an item as shown everywhere (derived, never stored). */
export function paddedOf(s: StateResponse, item: Item): number {
  return s.derived.padded[item.id] ?? padded(item.estimateMin, s.settings);
}

/** Reset for tests. */
export function resetStore(): void {
  if (source) source.close();
  source = null;
  useStore.setState({
    state: null,
    receivedAt: Date.now(),
    connected: false,
    toast: [],
    draft: '',
    lastCapture: null,
    mode: 'capture',
    cursor: null,
    view: 'backlog',
    filter: '',
    pendingChord: null,
    inline: null,
    helpOpen: false,
    updatePending: false,
    flash: [],
  });
}
