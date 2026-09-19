/**
 * The server's state layer (docs/CONTRACTS.md §2 "Writes" + SyncHost).
 *
 * Boot: load todos.json (migrate → validate; invalid → kept aside, last committed version or empty),
 * schedule.json (default when missing), day.json from the state dir, recent history; then rollover.
 * Every mutation goes through `dispatch`: reduce → on change: memory, history append
 * (history/YYYY-MM.jsonl), atomic todos.json write, day.json when the day changed,
 * `sync.notifyLocalChange()`, SSE `state` broadcast.
 */
import { execFile } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { DayStateSchema, HistoryEventSchema, migrateTodos, ScheduleSchema } from '../domain/schema';
import { derive } from '../domain/state/derive';
import { defaultSchedule, emptyDay, emptyTodos } from '../domain/state/initial';
import { reduce } from '../domain/state/reducer';
import { buildStats } from '../domain/state/stats';
import { addDays, todayISO } from '../domain/time';
import type {
  Action,
  Clock,
  DayState,
  Derived,
  DoneStats,
  HistoryEvent,
  Item,
  ReduceResult,
  Schedule,
  Settings,
  State,
  StatsRange,
  TodosFile,
} from '../domain/types';
import type { Broadcaster } from './broadcast';
import type { Logger } from './log';
import type { InboxFile, IngestResult, Sync, SyncHost, SyncStatus } from './sync/types';

const execFileAsync = promisify(execFile);

export interface VersionInfo {
  app: string;
  gitSha: string | null;
  buildSha: string;
}

export interface StateResponse {
  items: Item[];
  schedule: Schedule;
  day: DayState;
  derived: Derived;
  settings: Settings;
  sync: SyncStatus;
  version: VersionInfo;
  rolloverCount: number;
  problems: string[];
}

export interface StoreDeps {
  dataDir: string;
  stateDir: string;
  settings: Settings;
  clock: Clock;
  log: Logger;
  broadcaster: Broadcaster;
  version: VersionInfo;
  /** Problems discovered before the store existed (e.g. by config.ts); surfaced in StateResponse. */
  problems?: string[];
}

export interface DispatchOptions {
  /** false while the sync module drives an ingest (it commits itself; no debounce needed). */
  notifySync?: boolean;
}

export interface Store extends SyncHost {
  /** Boot: load every file, then run the rollover. Safe to call once. */
  load(): Promise<void>;
  getState(): State;
  dispatch(action: Action, opts?: DispatchOptions): ReduceResult;
  findItem(id: string): Item | undefined;
  stateResponse(): StateResponse;
  attachSync(sync: Sync): void;
  syncStatus(): SyncStatus;
  forceSync(): Promise<SyncStatus>;
  /** Replace schedule.json (validated by the caller) and persist it. */
  setSchedule(schedule: Schedule): void;
  /** Run the day rollover when the calendar day moved on since the last one. */
  rolloverIfNeeded(): void;
  rolloverCount(): number;
  problems(): string[];
  /** Epoch ms of the last user-driven mutation (not ingest), or null. */
  lastMutationAt(): number | null;
  recentHistory(): HistoryEvent[];
  /** Done tracker over the loaded history (last four months). */
  stats(range: StatsRange): DoneStats;
}

export const DISABLED_SYNC: SyncStatus = {
  enabled: false,
  lastSync: null,
  lastPush: null,
  remoteSha: null,
  pending: 0,
  offline: false,
  conflict: null,
  hermesLastSeen: null,
  rejectedCount: 0,
  lastError: null,
  cycles: 0,
};

let tmpSeq = 0;

/** Write `content` to `path` atomically (tmp file in the same directory + rename). */
export function writeAtomic(path: string, content: string): void {
  tmpSeq += 1;
  const tmp = `${path}.tmp-${process.pid}-${tmpSeq}`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, path);
}

export function toJsonFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function compactTs(clock: Clock): string {
  return clock
    .now()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function monthOf(day: string): string {
  return day.slice(0, 7);
}

function historyFile(month: string): string {
  return `history/${month}.jsonl`;
}

export function createStore(deps: StoreDeps): Store {
  const { dataDir, stateDir, settings, clock, log, broadcaster } = deps;
  const problems: string[] = [...(deps.problems ?? [])];
  const dirty = new Set<string>();
  let state: State = {
    todos: emptyTodos(clock),
    schedule: defaultSchedule(settings),
    day: emptyDay(clock),
  };
  let history: HistoryEvent[] = [];
  let historyMonths: string[] = [];
  let sync: Sync | null = null;
  let rolloverCount = 0;
  let lastMutation: number | null = null;

  const todosPath = join(dataDir, 'todos.json');
  const schedulePath = join(dataDir, 'schedule.json');
  const dayPath = join(stateDir, 'day.json');

  // ---------- files ----------

  function ensureDirs(): void {
    for (const d of [dataDir, join(dataDir, 'history'), join(dataDir, 'inbox'), stateDir]) {
      mkdirSync(d, { recursive: true });
    }
  }

  function parseTodosText(text: string): TodosFile {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new Error(`$: ${(e as Error).message}`);
    }
    return migrateTodos(raw);
  }

  async function lastCommittedTodos(): Promise<TodosFile | null> {
    if (!existsSync(join(dataDir, '.git'))) return null;
    try {
      const { stdout } = await execFileAsync('git', ['show', 'HEAD:todos.json'], {
        cwd: dataDir,
        timeout: 5000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        maxBuffer: 64 * 1024 * 1024,
      });
      return parseTodosText(stdout);
    } catch (e) {
      log('warn', 'git show HEAD:todos.json failed', { error: (e as Error).message });
      return null;
    }
  }

  async function loadTodos(): Promise<TodosFile> {
    if (!existsSync(todosPath)) {
      const todos = emptyTodos(clock);
      writeTodos(todos);
      log('info', 'todos.json missing; created empty');
      return todos;
    }
    const text = readFileSync(todosPath, 'utf8');
    try {
      return parseTodosText(text);
    } catch (e) {
      const keptAs = `todos.json.invalid-${compactTs(clock)}`;
      renameSync(todosPath, join(dataDir, keptAs));
      const msg = (e as Error).message;
      problems.push(`todos.json invalid at ${msg} (kept as ${keptAs})`);
      log('error', 'todos.json invalid', { at: msg, keptAs });
      const committed = await lastCommittedTodos();
      const todos = committed ?? emptyTodos(clock);
      problems.push(
        committed
          ? 'loaded the last committed todos.json instead'
          : 'no committed todos.json available; starting empty',
      );
      writeTodos(todos);
      return todos;
    }
  }

  function loadSchedule(): Schedule {
    if (!existsSync(schedulePath)) {
      const schedule = defaultSchedule(settings);
      writeSchedule(schedule);
      return schedule;
    }
    try {
      const parsed = ScheduleSchema.safeParse(JSON.parse(readFileSync(schedulePath, 'utf8')));
      if (parsed.success) return parsed.data as Schedule;
      const issue = parsed.error.issues[0];
      const at = issue ? issue.path.map(String).join('.') || '$' : '$';
      problems.push(
        `schedule.json invalid at ${at}: ${issue?.message ?? 'invalid'}; using defaults`,
      );
    } catch (e) {
      problems.push(`schedule.json is not valid JSON (${(e as Error).message}); using defaults`);
    }
    return defaultSchedule(settings);
  }

  /**
   * day.json missing or invalid → a sentinel date in the past, so the boot rollover always runs
   * (stale dated items from earlier days go back to Backlog) and resets the day to today.
   */
  function loadDay(): DayState {
    const sentinel: DayState = { date: '1970-01-01', freshStartAt: null, eveningRitualDone: false };
    if (!existsSync(dayPath)) return sentinel;
    try {
      const parsed = DayStateSchema.safeParse(JSON.parse(readFileSync(dayPath, 'utf8')));
      if (parsed.success) return parsed.data;
    } catch {
      // fall through
    }
    log('warn', 'day.json invalid; reset');
    return sentinel;
  }

  function loadHistory(): void {
    const today = todayISO(clock);
    // this month and the three before it: enough for the 3-month done tracker
    historyMonths = [];
    let month = monthOf(today);
    for (let i = 0; i < 4; i++) {
      historyMonths.unshift(month);
      month = monthOf(addDays(`${month}-01`, -1));
    }
    const events: HistoryEvent[] = [];
    let skipped = 0;
    for (const month of historyMonths) {
      const path = join(dataDir, historyFile(month));
      if (!existsSync(path)) continue;
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = HistoryEventSchema.safeParse(JSON.parse(trimmed));
          if (parsed.success) events.push(parsed.data as HistoryEvent);
          else skipped += 1;
        } catch {
          skipped += 1;
        }
      }
    }
    if (skipped > 0) log('warn', 'history lines skipped', { skipped });
    history = events;
  }

  function writeTodos(todos: TodosFile): void {
    writeAtomic(todosPath, toJsonFile(todos));
    dirty.add('todos.json');
  }

  function writeSchedule(schedule: Schedule): void {
    writeAtomic(schedulePath, toJsonFile(schedule));
    dirty.add('schedule.json');
  }

  function writeDay(day: DayState): void {
    writeAtomic(dayPath, toJsonFile(day));
  }

  function appendHistory(events: HistoryEvent[]): void {
    const byFile = new Map<string, string[]>();
    for (const ev of events) {
      const rel = historyFile(monthOf(ev.day));
      const lines = byFile.get(rel) ?? [];
      lines.push(JSON.stringify(ev));
      byFile.set(rel, lines);
    }
    for (const [rel, lines] of byFile) {
      appendFileSync(join(dataDir, rel), `${lines.join('\n')}\n`, 'utf8');
      dirty.add(rel);
    }
    history.push(...events);
    // keep the in-memory window at "this month + last month" as months roll over
    const today = todayISO(clock);
    const thisMonth = monthOf(today);
    if (!historyMonths.includes(thisMonth)) {
      const lastMonth = monthOf(addDays(`${thisMonth}-01`, -1));
      historyMonths = [lastMonth, thisMonth];
      history = history.filter((ev) => historyMonths.includes(monthOf(ev.day)));
    }
  }

  // ---------- core ----------

  function commit(result: ReduceResult, opts: DispatchOptions, userDriven: boolean): void {
    const before = state;
    state = result.state;
    if (result.events.length > 0) appendHistory(result.events);
    if (state.todos !== before.todos) writeTodos(state.todos);
    if (result.archived && result.archived.length > 0) writeArchive(result.archived);
    if (JSON.stringify(state.day) !== JSON.stringify(before.day)) writeDay(state.day);
    if (state.schedule !== before.schedule) writeSchedule(state.schedule);
    if (userDriven) lastMutation = Date.now();
    if (opts.notifySync !== false) sync?.notifyLocalChange();
    broadcaster.broadcast('state', stateResponse());
  }

  /** Append archived items to archive/YYYY-MM.json (Mac-owned, committed by the sync module). */
  function writeArchive(items: Item[]): void {
    const rel = `archive/${monthOf(todayISO(clock))}.json`;
    const path = join(dataDir, rel);
    mkdirSync(dirname(path), { recursive: true });
    let existing: unknown[] = [];
    if (existsSync(path)) {
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        if (Array.isArray(parsed)) existing = parsed;
      } catch {
        log('warn', 'archive file unreadable; starting a new list', { file: rel });
      }
    }
    writeAtomic(path, toJsonFile([...existing, ...items]));
    dirty.add(rel);
  }

  function dispatch(action: Action, opts: DispatchOptions = {}): ReduceResult {
    const result = reduce(state, action, clock, settings);
    if (!result.changed) return result;
    commit(result, opts, action.type !== 'ingest' && action.type !== 'rollover');
    return result;
  }

  function rolloverIfNeeded(): void {
    if (state.day.date === todayISO(clock)) return;
    const result = dispatch({ type: 'rollover' }, { notifySync: true });
    const moved = result.events.filter(
      (ev) => ev.type === 'rescheduled' && ev.reason === 'rollover',
    ).length;
    rolloverCount = moved;
    if (result.changed) log('info', 'rollover', { moved, date: state.day.date });
  }

  function stateResponse(): StateResponse {
    return {
      items: state.todos.items,
      schedule: state.schedule,
      day: state.day,
      derived: derive(state, clock, settings, history),
      settings,
      sync: sync ? sync.status() : DISABLED_SYNC,
      version: deps.version,
      rolloverCount,
      problems,
    };
  }

  // ---------- SyncHost ----------

  async function reloadFromDisk(): Promise<void> {
    let todos = state.todos;
    let schedule = state.schedule;
    try {
      if (existsSync(todosPath)) todos = parseTodosText(readFileSync(todosPath, 'utf8'));
    } catch (e) {
      const msg = `todos.json invalid after reload at ${(e as Error).message}; kept the previous state`;
      problems.push(msg);
      log('error', msg);
    }
    try {
      if (existsSync(schedulePath)) {
        const parsed = ScheduleSchema.safeParse(JSON.parse(readFileSync(schedulePath, 'utf8')));
        if (parsed.success) schedule = parsed.data as Schedule;
        else problems.push('schedule.json invalid after reload; kept the previous schedule');
      }
    } catch (e) {
      problems.push(`schedule.json unreadable after reload (${(e as Error).message})`);
    }
    state = { ...state, todos, schedule };
    broadcaster.broadcast('state', stateResponse());
  }

  async function ingest(files: InboxFile[]): Promise<IngestResult> {
    const result: IngestResult = { outcomes: [], added: [], changed: [] };
    for (const f of files) {
      const r = dispatch(
        { type: 'ingest', command: f.command, file: f.name },
        { notifySync: false },
      );
      const outcome: IngestResult['outcomes'][number] = {
        file: f.name,
        ok: r.changed,
        op: f.command.op,
      };
      if (r.warning !== undefined) outcome.error = r.warning;
      if (r.item) outcome.itemId = r.item.id;
      result.outcomes.push(outcome);
      if (!r.changed || !r.item) continue;
      if (f.command.op === 'add') result.added.push(r.item.id);
      else if (f.command.op === 'done') result.changed.push({ id: r.item.id, field: 'status' });
      else if (f.command.op === 'update') {
        const edited = r.events.find((ev) => ev.type === 'edited' && ev.itemId === r.item?.id);
        for (const field of (edited?.detail ?? '').split(',').filter(Boolean)) {
          result.changed.push({ id: r.item.id, field });
        }
      }
    }
    return result;
  }

  async function flush(): Promise<string[]> {
    // Every write already happened synchronously inside dispatch; report what changed since the last flush.
    const paths = [...dirty].sort();
    dirty.clear();
    return paths;
  }

  return {
    dataDir,
    async load() {
      ensureDirs();
      state = {
        todos: await loadTodos(),
        schedule: loadSchedule(),
        day: loadDay(),
      };
      loadHistory();
      rolloverIfNeeded();
      const stuck = state.todos.items.filter((it) => it.llm?.status === 'pending');
      for (const it of stuck) {
        dispatch({ type: 'edit', id: it.id, patch: { llm: { ...it.llm!, status: 'failed' } } });
      }
      if (stuck.length > 0) {
        log('warn', 'formatting was interrupted by a restart; items kept as typed', {
          items: stuck.length,
        });
      }
      dirty.clear();
      log('info', 'state loaded', {
        items: state.todos.items.length,
        history: history.length,
        problems: problems.length,
      });
    },
    getState: () => state,
    dispatch,
    findItem: (id) => state.todos.items.find((it) => it.id === id),
    stateResponse,
    attachSync(s) {
      sync = s;
    },
    syncStatus: () => (sync ? sync.status() : DISABLED_SYNC),
    forceSync: async () => (sync ? sync.forceCycle() : DISABLED_SYNC),
    setSchedule(schedule) {
      state = { ...state, schedule };
      writeSchedule(schedule);
      lastMutation = Date.now();
      sync?.notifyLocalChange();
      broadcaster.broadcast('state', stateResponse());
    },
    rolloverIfNeeded,
    rolloverCount: () => rolloverCount,
    problems: () => problems,
    lastMutationAt: () => lastMutation,
    recentHistory: () => history,
    stats: (range) => buildStats(history, todayISO(clock), range),
    reloadFromDisk,
    ingest,
    flush,
    emit(event, payload) {
      broadcaster.broadcast(event, payload);
    },
    log(level, msg, extra) {
      log(level, msg, extra);
    },
  };
}
