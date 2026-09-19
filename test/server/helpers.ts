/**
 * Builds the server app in-process against a temp QUICKDO_HOME / data dir with a fixed clock.
 * No port is ever bound; requests go through `app.request()`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { emptyTodos } from '../../src/domain/state/initial';
import {
  DEFAULT_SETTINGS,
  type Item,
  type LlmFormat,
  type TodosFile,
} from '../../src/domain/types';
import { createApp } from '../../src/server/app';
import { type Broadcaster, createBroadcaster } from '../../src/server/broadcast';
import { createClock, type ServerClock } from '../../src/server/clock';
import { loadConfig } from '../../src/server/config';
import type { Formatter } from '../../src/server/llm/format';
import { silentLogger } from '../../src/server/log';
import { createStore, type StateResponse, type Store } from '../../src/server/state';

export const FIXED_NOW = '2026-09-18T09:12:00+02:00'; // Friday
export const TODAY = '2026-09-18';
export const TOMORROW = '2026-09-19';
export const YESTERDAY = '2026-09-17';
export const PORT = 7799;

export const JSON_HEADERS = {
  'content-type': 'application/json',
  'x-quickdo-client': '1',
  host: `127.0.0.1:${PORT}`,
};

export interface Sandbox {
  home: string;
  dataDir: string;
  stateDir: string;
  clock: ServerClock;
  broadcaster: Broadcaster;
  store: Store;
  app: Hono;
  cleanup(): void;
  get(path: string): Promise<Response>;
  post(path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
  patch(path: string, body?: unknown): Promise<Response>;
  put(path: string, body?: unknown): Promise<Response>;
  state(): Promise<StateResponse>;
}

export interface SandboxOptions {
  now?: string;
  testClock?: boolean;
  /** Seed todos.json before boot: a TodosFile, a list of items, or raw text (e.g. invalid JSON). */
  todos?: TodosFile | Item[] | string;
  /** Seed schedule.json (raw text) before boot. */
  schedule?: string;
  /** Skip `store.load()` (to drive boot by hand). */
  noLoad?: boolean;
  formatter?: Formatter;
  onFormatSettled?: (id: string, status: LlmFormat['status']) => void;
}

export function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'quickdo-test-'));
}

export async function makeSandbox(opts: SandboxOptions = {}): Promise<Sandbox> {
  const home = tempHome();
  const dataDir = join(home, 'data');
  mkdirSync(dataDir, { recursive: true });
  const config = loadConfig({
    QUICKDO_HOME: home,
    QUICKDO_DATA_DIR: dataDir,
    QUICKDO_PORT: String(PORT),
    QUICKDO_SYNC: 'off',
    QUICKDO_TEST_CLOCK: opts.testClock ? '1' : undefined,
  });
  const clock = createClock(DEFAULT_SETTINGS.timezone, opts.now ?? FIXED_NOW);

  if (opts.todos !== undefined) {
    const text =
      typeof opts.todos === 'string'
        ? opts.todos
        : `${JSON.stringify(
            Array.isArray(opts.todos) ? { ...emptyTodos(clock), items: opts.todos } : opts.todos,
            null,
            2,
          )}\n`;
    writeFileSync(join(dataDir, 'todos.json'), text);
  }
  if (opts.schedule !== undefined) writeFileSync(join(dataDir, 'schedule.json'), opts.schedule);

  const broadcaster = createBroadcaster();
  const version = { app: '0.1.0', gitSha: null, buildSha: 'test' };
  const store = createStore({
    dataDir: config.dataDir,
    stateDir: config.stateDir,
    settings: config.settings,
    clock,
    log: silentLogger,
    broadcaster,
    version,
    problems: config.problems,
  });
  if (!opts.noLoad) await store.load();

  const app = createApp({
    store,
    formatter: opts.formatter,
    onFormatSettled: opts.onFormatSettled,
    clock,
    settings: config.settings,
    port: config.port,
    testClock: config.testClock,
    version,
    log: silentLogger,
    broadcaster,
    webDir: null,
  });

  const send = async (
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) =>
    app.request(path, {
      method,
      headers: { ...JSON_HEADERS, ...headers },
      body: JSON.stringify(body ?? {}),
    });

  return {
    home,
    dataDir,
    stateDir: config.stateDir,
    clock,
    broadcaster,
    store,
    app,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
    get: async (path) => app.request(path),
    post: (path, body, headers) => send('POST', path, body, headers),
    patch: (path, body) => send('PATCH', path, body),
    put: (path, body) => send('PUT', path, body),
    state: async () => (await app.request('/api/state')).json() as Promise<StateResponse>,
  };
}

let seq = 0;

/** A minimal open item (mirrors src/domain/testing/fixtures.ts, kept local so server tests stay self-contained). */
export function item(over: Partial<Item> = {}): Item {
  seq += 1;
  return {
    id: over.id ?? `01SRV${String(seq).padStart(21, '0')}`,
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

/** Capture through the API and return the created item. */
export async function capture(sb: Sandbox, text: string, target?: string): Promise<Item> {
  const res = await sb.post('/api/capture', target ? { text, target } : { text });
  if (res.status !== 201) throw new Error(`capture failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { item: Item }).item;
}
