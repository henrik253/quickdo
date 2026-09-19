/**
 * Typed fetch helpers for the local quickdo server (docs/CONTRACTS.md §2).
 * Every mutating call sends `Content-Type: application/json` and `X-Quickdo-Client: 1`.
 */
import type {
  CaptureTarget,
  DayState,
  Derived,
  DoneStats,
  EditablePatch,
  Item,
  Schedule,
  Settings,
  SourceKind,
  StatsRange,
} from '../domain/types';
import type { SyncStatus } from '../server/sync/types';

export interface StateResponse {
  items: Item[];
  schedule: Schedule;
  day: DayState;
  derived: Derived;
  settings: Settings;
  sync: SyncStatus;
  version: { app: string; gitSha: string | null; buildSha: string };
  rolloverCount: number;
  problems: string[];
}

export interface CaptureResponse {
  item: Item;
  parsed: { tokens: unknown[]; warnings: string[] };
  state: StateResponse;
}

export interface StateResult {
  state: StateResponse;
  warning?: string;
}

export type ItemAction =
  | 'done'
  | 'undo'
  | 'skip'
  | 'drop'
  | 'start'
  | 'extend'
  | 'today'
  | 'tomorrow'
  | 'backlog'
  | 'next'
  | 'accept'
  | 'clearBlock'
  | 'archive';

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export const MUTATION_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Quickdo-Client': '1',
};

async function request<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT', path: string, body?: unknown) {
  const init: RequestInit = { method };
  if (method !== 'GET') {
    init.headers = MUTATION_HEADERS;
    init.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(path, init);
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : data && typeof data === 'object' && 'warning' in data
          ? String((data as { warning: unknown }).warning)
          : `HTTP ${res.status}`;
    throw new ApiError(res.status, data, msg);
  }
  return data as T;
}

export const api = {
  state: () => request<StateResponse>('GET', '/api/state'),
  health: () => request<{ ok: boolean; uptimeSec: number; version: string }>('GET', '/api/health'),
  capture: (text: string, target?: CaptureTarget, source: SourceKind = 'ui') =>
    request<CaptureResponse>('POST', '/api/capture', { text, target, source }),
  itemAction: (id: string, action: ItemAction, body?: { minutes?: number }) =>
    request<StateResult>('POST', `/api/items/${encodeURIComponent(id)}/${action}`, body ?? {}),
  patchItem: (id: string, patch: EditablePatch) =>
    request<StateResult>('PATCH', `/api/items/${encodeURIComponent(id)}`, patch),
  freshStart: () => request<StateResult>('POST', '/api/day/freshStart'),
  clearDone: () => request<StateResult & { archived: number }>('POST', '/api/day/clearDone'),
  stats: (range: StatsRange) => request<DoneStats>('GET', `/api/stats?range=${range}`),
  commit: (ids: string[], cues: Record<string, string>) =>
    request<StateResult>('POST', '/api/day/commit', { ids, cues }),
  sync: () => request<{ sync: SyncStatus }>('POST', '/api/sync'),
  syncStatus: () => request<{ sync: SyncStatus }>('GET', '/api/sync/status'),
};
