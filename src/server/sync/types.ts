/**
 * Contract between the server core (src/server/state.ts, index.ts) and the git sync module
 * (src/server/sync/*). See docs/CONTRACTS.md §Sync and docs/PLAN.md §6.
 */
import type { InboxCommand, IngestOutcome } from '../../domain/types';

export interface SyncStatus {
  enabled: boolean;
  lastSync: string | null; // ISO instant of the last successful cycle
  lastPush: string | null;
  remoteSha: string | null;
  pending: number; // local commits not yet pushed
  offline: boolean;
  conflict: { at: string; branch: string } | null; // last RECOVERY, if any
  hermesLastSeen: string | null; // ISO instant of the last ingested agent command
  rejectedCount: number; // files currently in inbox/rejected
  lastError: string | null;
  cycles: number;
}

export interface InboxFile {
  name: string; // file name inside inbox/
  command: InboxCommand; // already schema-validated by the sync module
}

export interface IngestResult {
  outcomes: IngestOutcome[]; // one per file, in order
  added: string[]; // item ids added
  changed: Array<{ id: string; field: string }>;
}

/**
 * What the sync module needs from the server core. All methods are invoked while the sync
 * mutex is held, so the host must not start its own git operations.
 */
export interface SyncHost {
  dataDir: string; // absolute path of the quickdo-data clone
  /** Re-read todos.json / schedule.json from disk (after a rebase or RECOVERY restored files). */
  reloadFromDisk(): Promise<void>;
  /** Apply validated agent commands through the domain reducer. Must be idempotent per dedupeKey. */
  ingest(files: InboxFile[]): Promise<IngestResult>;
  /** Write every dirty Mac-owned file (todos.json, history/*.jsonl, schedule.json). Returns relative paths written. */
  flush(): Promise<string[]>;
  /** Broadcast to SSE clients. */
  emit(event: 'sync' | 'agent', payload: unknown): void;
  log(level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>): void;
}

export interface SyncOptions {
  branch?: string; // default 'main'
  pollSeconds?: number; // default 60
  commitDebounceMs?: number; // default 3000
  pushDebounceMs?: number; // default 15000
  gitTimeoutMs?: number; // default 15000
  authorName?: string; // default 'quickdo'
  authorEmail?: string; // default 'quickdo@localhost'
}

export interface Sync {
  start(): void;
  stop(): Promise<void>;
  /** Called by the host after any local mutation was flushed; schedules commit (3 s) and push (15 s). */
  notifyLocalChange(): void;
  /** Run a cycle now (coalesced with any queued one). Resolves when it finished. */
  forceCycle(): Promise<SyncStatus>;
  status(): SyncStatus;
}
