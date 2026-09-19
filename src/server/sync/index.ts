/**
 * Git sync with the private data repo (docs/CONTRACTS.md §3, docs/PLAN.md §6). Everything —
 * every git command and every host call — runs inside one mutex (see mutex.ts); cycles run on a
 * timer, after local changes (debounced) and on demand.
 */
import { BACKOFF_MIN_MS, type CycleContext, runCycle } from './cycle';
import { createGitRunner } from './git';
import { createCycleQueue } from './mutex';
import type { Sync, SyncHost, SyncOptions, SyncStatus } from './types';

export const DEFAULTS = {
  branch: 'main',
  pollSeconds: 60,
  commitDebounceMs: 3_000,
  pushDebounceMs: 15_000,
  gitTimeoutMs: 15_000,
  authorName: 'quickdo',
  authorEmail: 'quickdo@localhost',
} as const;

export function createSync(host: SyncHost, opts: SyncOptions = {}): Sync {
  const branch = opts.branch ?? DEFAULTS.branch;
  const pollMs = (opts.pollSeconds ?? DEFAULTS.pollSeconds) * 1000;
  const commitDebounceMs = opts.commitDebounceMs ?? DEFAULTS.commitDebounceMs;

  const status: SyncStatus = {
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

  const git = createGitRunner(host.dataDir, {
    timeoutMs: opts.gitTimeoutMs ?? DEFAULTS.gitTimeoutMs,
    authorName: opts.authorName ?? DEFAULTS.authorName,
    authorEmail: opts.authorEmail ?? DEFAULTS.authorEmail,
  });

  const ctx: CycleContext = {
    git,
    host,
    branch,
    status,
    backoffMs: BACKOFF_MIN_MS,
    nextAttemptAt: 0,
  };

  let ready: Promise<void> | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const queue = createCycleQueue<SyncStatus>(async (force) => {
    if (!status.enabled || stopped) return { ...status };
    try {
      return await runCycle(ctx, force);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      status.lastError = message.split('\n')[0];
      host.log('error', 'sync cycle failed', { error: status.lastError });
      host.emit('sync', { ...status });
      return { ...status };
    }
  });

  /** Is dataDir a git work tree with an `origin` remote? Sets status.enabled and logs why not. */
  async function detect(): Promise<void> {
    const inside = await git.tryRun(['rev-parse', '--is-inside-work-tree']);
    if (inside?.trim() !== 'true') {
      status.enabled = false;
      host.log('warn', 'sync disabled: data dir is not a git repository', {
        dataDir: host.dataDir,
      });
      return;
    }
    const origin = await git.tryRun(['remote', 'get-url', 'origin']);
    if (!origin?.trim()) {
      status.enabled = false;
      host.log('warn', 'sync disabled: data repo has no origin remote', { dataDir: host.dataDir });
      return;
    }
    status.enabled = true;
    host.log('info', 'sync enabled', { branch, pollSeconds: pollMs / 1000 });
  }

  function ensureReady(): Promise<void> {
    if (!ready) ready = detect();
    return ready;
  }

  function schedule(force: boolean): Promise<SyncStatus> {
    return ensureReady().then(() => {
      if (!status.enabled || stopped) return { ...status };
      return queue.enqueue(force);
    });
  }

  return {
    start() {
      stopped = false;
      void ensureReady().then(() => {
        if (!status.enabled || stopped) return;
        timer = setInterval(() => void schedule(false), pollMs);
        timer.unref();
        void schedule(false);
      });
    },

    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      if (debounce) clearTimeout(debounce);
      debounce = null;
      await queue.onIdle();
    },

    notifyLocalChange() {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        void schedule(false);
      }, commitDebounceMs);
      debounce.unref();
    },

    forceCycle() {
      return schedule(true);
    },

    status: () => ({ ...status }),
  };
}

export type { Sync, SyncHost, SyncOptions, SyncStatus } from './types';
