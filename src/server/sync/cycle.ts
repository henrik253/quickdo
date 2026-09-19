/**
 * One sync cycle (docs/PLAN.md §6 "Mac side"). Always called with the sync mutex held.
 *
 *  1. flush + commit dirty Mac-owned paths ("ui: n change(s)")
 *  2. ls-remote (failure → offline + backoff, return)
 *  3. nothing to do → return
 *  4. fetch + rebase --autostash (failure → RECOVERY)
 *  5. rebase brought commits → host.reloadFromDisk()
 *  6. ingest inbox/ (valid → host.ingest → git rm; invalid → rejected/ + .error.txt), commit
 *  7. push (non-ff → fetch/rebase/push, 3 tries; network → offline)
 *  8. status + emits
 */
import { type GitRunner, isNetworkError, isNonFastForward, parsePorcelain } from './git';
import {
  checkInboxFile,
  countRejected,
  listInboxFiles,
  rejectInboxFile,
  removeInboxFile,
} from './inbox';
import { runRecovery } from './recovery';
import type { InboxFile, SyncHost, SyncStatus } from './types';

export const MAC_OWNED_PREFIXES = ['todos.json', 'schedule.json', 'history/', 'archive/'];
export const BACKOFF_MIN_MS = 5_000;
export const BACKOFF_MAX_MS = 5 * 60_000;
export const PUSH_TRIES = 3;

export function isMacOwned(path: string): boolean {
  return MAC_OWNED_PREFIXES.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p));
}

export interface CycleContext {
  git: GitRunner;
  host: SyncHost;
  branch: string;
  status: SyncStatus;
  backoffMs: number;
  nextAttemptAt: number;
}

/** Stage every dirty Mac-owned path; returns how many entries were staged. */
async function stageMacOwned(ctx: CycleContext): Promise<number> {
  const raw = await ctx.git.run(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const paths = new Set<string>();
  for (const entry of parsePorcelain(raw)) {
    if (isMacOwned(entry.path)) paths.add(entry.path);
    if (entry.from && isMacOwned(entry.from)) paths.add(entry.from);
  }
  if (paths.size === 0) return 0;
  await ctx.git.run(['add', '-A', '--', ...paths]);
  return paths.size;
}

async function hasStaged(ctx: CycleContext): Promise<boolean> {
  const out = await ctx.git.run(['diff', '--cached', '--name-only']);
  return out.trim().length > 0;
}

async function commit(ctx: CycleContext, message: string): Promise<void> {
  await ctx.git.run(['commit', '-q', '-m', message]);
}

async function aheadCount(ctx: CycleContext): Promise<number> {
  const out = await ctx.git.tryRun(['rev-list', '--count', `origin/${ctx.branch}..HEAD`]);
  if (out === null) {
    const all = await ctx.git.tryRun(['rev-list', '--count', 'HEAD']);
    return all ? Number.parseInt(all.trim(), 10) || 0 : 0;
  }
  return Number.parseInt(out.trim(), 10) || 0;
}

async function remoteTrackingSha(ctx: CycleContext): Promise<string | null> {
  const out = await ctx.git.tryRun(['rev-parse', '--verify', '-q', `origin/${ctx.branch}`]);
  return out?.trim() || null;
}

function goOffline(ctx: CycleContext, err: unknown, where: string): void {
  const message = err instanceof Error ? err.message : String(err);
  ctx.status.offline = true;
  ctx.status.lastError = `${where}: ${message.split('\n')[0]}`;
  ctx.nextAttemptAt = Date.now() + ctx.backoffMs;
  ctx.host.log('warn', 'sync offline', { where, backoffMs: ctx.backoffMs });
  ctx.backoffMs = Math.min(ctx.backoffMs * 2, BACKOFF_MAX_MS);
}

function backOnline(ctx: CycleContext): void {
  ctx.status.offline = false;
  ctx.backoffMs = BACKOFF_MIN_MS;
  ctx.nextAttemptAt = 0;
}

async function finish(ctx: CycleContext): Promise<void> {
  ctx.status.pending = await aheadCount(ctx);
  ctx.status.rejectedCount = await countRejected(ctx.host.dataDir);
  ctx.host.emit('sync', { ...ctx.status });
}

interface IngestSummary {
  ingested: number;
  rejected: number;
  by: string[];
  lastAt: string | null;
  added: string[];
  changed: Array<{ id: string; field: string }>;
}

async function ingestInbox(ctx: CycleContext): Promise<IngestSummary> {
  const summary: IngestSummary = {
    ingested: 0,
    rejected: 0,
    by: [],
    lastAt: null,
    added: [],
    changed: [],
  };
  const names = await listInboxFiles(ctx.host.dataDir);
  if (names.length === 0) return summary;

  const valid: InboxFile[] = [];
  for (const name of names) {
    const checked = await checkInboxFile(ctx.host.dataDir, name);
    if (checked.ok) {
      valid.push(checked.file);
    } else {
      await rejectInboxFile(ctx.host.dataDir, ctx.git, name, checked.error);
      summary.rejected += 1;
      ctx.host.log('warn', 'inbox file rejected', { file: name, error: checked.error });
    }
  }

  if (valid.length > 0) {
    const result = await ctx.host.ingest(valid);
    const byName = new Map(result.outcomes.map((o) => [o.file, o]));
    for (const file of valid) {
      const outcome = byName.get(file.name);
      if (outcome?.ok) {
        await removeInboxFile(ctx.git, file.name);
        summary.ingested += 1;
        if (!summary.by.includes(file.command.by)) summary.by.push(file.command.by);
        if (!summary.lastAt || file.command.at > summary.lastAt) summary.lastAt = file.command.at;
      } else {
        const error = outcome?.error ?? 'ingest: no outcome reported';
        await rejectInboxFile(ctx.host.dataDir, ctx.git, file.name, error);
        summary.rejected += 1;
        ctx.host.log('warn', 'inbox command rejected', { file: file.name, error });
      }
    }
    summary.added = result.added;
    summary.changed = result.changed;
  }

  await ctx.host.flush();
  await stageMacOwned(ctx);
  if (await hasStaged(ctx)) {
    const by = summary.by.length > 0 ? summary.by.join(',') : 'agent';
    await commit(ctx, `ingest: ${summary.ingested} from ${by} (${summary.rejected} rejected)`);
  }
  return summary;
}

/** Push local commits; on non-fast-forward rebase and retry. Returns true when everything is pushed. */
async function pushWithRetry(ctx: CycleContext): Promise<boolean> {
  for (let attempt = 1; attempt <= PUSH_TRIES; attempt++) {
    try {
      await ctx.git.run(['push', '-q', 'origin', `HEAD:${ctx.branch}`]);
      ctx.status.lastPush = new Date().toISOString();
      return true;
    } catch (err) {
      if (isNonFastForward(err) && !isNetworkError(err)) {
        ctx.host.log('warn', 'push rejected, rebasing', { attempt });
        try {
          await ctx.git.run(['fetch', '-q', 'origin']);
        } catch (fetchErr) {
          goOffline(ctx, fetchErr, 'fetch');
          return false;
        }
        try {
          await ctx.git.run(['rebase', '--autostash', `origin/${ctx.branch}`]);
        } catch (rebaseErr) {
          const message = rebaseErr instanceof Error ? rebaseErr.message : String(rebaseErr);
          ctx.status.conflict = await runRecovery(ctx.git, ctx.host, ctx.branch, message);
        }
        continue;
      }
      if (isNetworkError(err)) {
        goOffline(ctx, err, 'push');
        return false;
      }
      ctx.status.lastError = `push: ${(err as Error).message.split('\n')[0]}`;
      ctx.host.log('error', 'push failed', { error: ctx.status.lastError });
      return false;
    }
  }
  ctx.status.lastError = `push: still rejected after ${PUSH_TRIES} tries`;
  ctx.host.log('error', 'push failed', { error: ctx.status.lastError });
  return false;
}

export async function runCycle(ctx: CycleContext, force: boolean): Promise<SyncStatus> {
  const { git, host, status } = ctx;
  status.cycles += 1;

  // (1) commit local changes — works offline too.
  await host.flush();
  let statusOk = true;
  try {
    const n = await stageMacOwned(ctx);
    if (n > 0 && (await hasStaged(ctx))) await commit(ctx, `ui: ${n} change(s)`);
  } catch (err) {
    statusOk = false;
    host.log('error', 'git status failed', { error: (err as Error).message });
  }

  if (!force && status.offline && Date.now() < ctx.nextAttemptAt) {
    await finish(ctx);
    return { ...status };
  }

  // (2) is the remote reachable, and where is it?
  let remoteSha: string | null;
  try {
    const out = await git.run(['ls-remote', '--heads', 'origin', ctx.branch]);
    remoteSha = out.trim().split(/\s+/)[0] || null;
  } catch (err) {
    goOffline(ctx, err, 'ls-remote');
    await finish(ctx);
    return { ...status };
  }
  backOnline(ctx);

  if (!statusOk) {
    // 'git status' failing means the tree is in a bad state: recover from origin.
    status.conflict = await runRecovery(git, host, ctx.branch, 'git status failed');
  }

  // (3) nothing to do?
  const ahead = await aheadCount(ctx);
  const inboxNames = await listInboxFiles(host.dataDir);
  if (statusOk && remoteSha === status.remoteSha && ahead === 0 && inboxNames.length === 0) {
    status.lastSync = new Date().toISOString();
    status.lastError = null;
    await finish(ctx);
    return { ...status };
  }

  // (4)+(5) integrate the remote.
  if (remoteSha !== null) {
    const before = await remoteTrackingSha(ctx);
    try {
      await git.run(['fetch', '-q', 'origin']);
    } catch (err) {
      goOffline(ctx, err, 'fetch');
      await finish(ctx);
      return { ...status };
    }
    const after = await remoteTrackingSha(ctx);
    if (before !== after) {
      try {
        await git.run(['rebase', '--autostash', `origin/${ctx.branch}`]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        status.conflict = await runRecovery(git, host, ctx.branch, message);
      }
      await host.reloadFromDisk();
    }
  }

  // (6) ingest.
  const ingest = await ingestInbox(ctx);

  // (7) push.
  if ((await aheadCount(ctx)) > 0) {
    await pushWithRetry(ctx);
  }

  // (8) status.
  status.remoteSha = (await remoteTrackingSha(ctx)) ?? remoteSha;
  status.lastSync = new Date().toISOString();
  if (!status.offline) status.lastError = null;
  if (ingest.ingested > 0) status.hermesLastSeen = ingest.lastAt ?? new Date().toISOString();
  await finish(ctx);
  if (ingest.added.length > 0 || ingest.changed.length > 0) {
    host.emit('agent', { added: ingest.added, changed: ingest.changed });
  }
  return { ...status };
}
