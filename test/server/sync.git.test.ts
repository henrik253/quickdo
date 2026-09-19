/**
 * Git behaviour of the sync module against a real bare origin with a "mac" clone (the host's
 * dataDir) and a "hermes" clone. Every git command runs in os.tmpdir().
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSync, type Sync } from '../../src/server/sync';
import {
  addCommand,
  BRANCH,
  createFakeHost,
  emptyTodos,
  git,
  hermesPush,
  inboxName,
  mergeCommitCount,
  originLog,
  type Repos,
  readTodos,
  setupRepos,
} from './sync.helpers';

const NEVER = 60 * 60 * 24; // pollSeconds: only forceCycle drives cycles

let repos: Repos | null = null;
let sync: Sync | null = null;

afterEach(async () => {
  await sync?.stop();
  sync = null;
  repos?.cleanup();
  repos = null;
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('sync.git', () => {
  it('[F-026] ingests a pushed inbox command, removes the file and pushes the result', async () => {
    repos = setupRepos();
    const host = createFakeHost(repos.mac);
    sync = createSync(host, { pollSeconds: NEVER });
    sync.start();

    const name = inboxName('reply-alice');
    hermesPush(repos.hermes, name, addCommand('Reply to alice', { dedupeKey: 'issue-1' }));

    const status = await sync.forceCycle();

    expect(status.enabled).toBe(true);
    expect(status.offline).toBe(false);
    expect(status.conflict).toBeNull();
    expect(status.pending).toBe(0);
    expect(status.hermesLastSeen).toBe('2026-09-18T07:03:00Z');
    expect(host.ingestCalls).toHaveLength(1);
    expect(host.ingestCalls[0][0].name).toBe(name);
    expect(host.ingestCalls[0][0].command.op).toBe('add');
    expect(host.items.map((i) => i.title)).toEqual(['Reply to alice']);

    // file gone locally and on origin, todos.json on origin has the item
    expect(existsSync(join(repos.mac, 'inbox', name))).toBe(false);
    expect(git(repos.origin, 'ls-tree', '--name-only', BRANCH, 'inbox/')).not.toContain(name);
    const originTodos = JSON.parse(git(repos.origin, 'show', `${BRANCH}:todos.json`));
    expect(originTodos.items[0].title).toBe('Reply to alice');
    expect(originTodos.items[0].source.by).toBe('hermes');
    expect(originLog(repos.origin)[0]).toBe('ingest: 1 from hermes (0 rejected)');
    expect(git(repos.mac, 'rev-parse', 'HEAD')).toBe(git(repos.origin, 'rev-parse', BRANCH));

    const agent = host.emitted.find((e) => e.event === 'agent');
    expect(agent?.payload).toEqual({ added: [host.items[0].id], changed: [] });
    expect(host.emitted.some((e) => e.event === 'sync')).toBe(true);
  });

  it('[F-026] concurrent mac and hermes commits rebase into a linear history', async () => {
    repos = setupRepos();
    const host = createFakeHost(repos.mac);
    sync = createSync(host, { pollSeconds: NEVER });
    sync.start();

    host.addLocal('Read paper X');
    hermesPush(repos.hermes, inboxName('lecture-a'), addCommand('Prepare Lecture A'));

    const status = await sync.forceCycle();

    expect(status.conflict).toBeNull();
    expect(status.pending).toBe(0);
    expect(host.items.map((i) => i.title).sort()).toEqual(['Prepare Lecture A', 'Read paper X']);
    expect(mergeCommitCount(repos.mac)).toBe(0);
    expect(mergeCommitCount(repos.origin)).toBe(0);
    const log = originLog(repos.origin);
    expect(log).toContain('ui: 1 change(s)');
    expect(log).toContain('hermes: add');
    expect(log[0]).toBe('ingest: 1 from hermes (0 rejected)');
    expect(git(repos.mac, 'rev-parse', 'HEAD')).toBe(git(repos.origin, 'rev-parse', BRANCH));
    expect(git(repos.mac, 'status', '--porcelain')).toBe('');
  });

  it('[F-026] a contract violation by hermes triggers RECOVERY that keeps the Mac version', async () => {
    repos = setupRepos();
    const host = createFakeHost(repos.mac);
    sync = createSync(host, { pollSeconds: NEVER });
    sync.start();

    const local = host.addLocal('Read paper X');
    await host.flush();

    // hermes breaks the contract: rewrites todos.json and pushes
    git(repos.hermes, 'pull', '-q', '--rebase', 'origin', BRANCH);
    const tampered = { ...emptyTodos(), updatedAt: '2026-09-18T09:00:00Z', items: [{ bogus: 1 }] };
    writeFileSync(join(repos.hermes, 'todos.json'), `${JSON.stringify(tampered, null, 2)}\n`);
    git(repos.hermes, 'commit', '-q', '-am', 'hermes: rewrite todos.json');
    git(repos.hermes, 'push', '-q', 'origin', `HEAD:${BRANCH}`);

    const status = await sync.forceCycle();

    expect(status.conflict).not.toBeNull();
    expect(status.conflict?.branch).toMatch(/^conflict\//);
    const branches = git(repos.mac, 'branch', '--list', 'conflict/*');
    expect(branches).toContain('conflict/');
    // the Mac version won
    const todos = readTodos(repos.mac);
    expect(todos.items.map((i) => i.id)).toEqual([local.id]);
    expect(host.items.map((i) => i.id)).toEqual([local.id]);
    expect(host.reloads).toBeGreaterThan(0);
    // origin was fast-forwarded to the resolution
    expect(git(repos.mac, 'rev-parse', 'HEAD')).toBe(git(repos.origin, 'rev-parse', BRANCH));
    expect(originLog(repos.origin)[0]).toBe('resolve: restore Mac-owned paths after conflict');
    expect(mergeCommitCount(repos.origin)).toBe(0);
    expect(status.pending).toBe(0);
    expect(host.logs.some((l) => l.level === 'warn' && /recovery/.test(l.msg))).toBe(true);
    // the parked branch still has the hermes-free local commit
    const parked = git(repos.mac, 'log', '--format=%s', status.conflict?.branch ?? '');
    expect(parked).toContain('ui: 1 change(s)');
  });

  it('[F-026] an unreachable origin means offline, commits accumulate, then recovers', async () => {
    repos = setupRepos();
    const host = createFakeHost(repos.mac);
    sync = createSync(host, { pollSeconds: NEVER, gitTimeoutMs: 5000 });
    sync.start();

    git(repos.mac, 'remote', 'set-url', 'origin', 'http://127.0.0.1:9/');

    for (let i = 0; i < 3; i++) {
      host.addLocal(`Offline item ${i}`);
      await host.flush();
      const status = await sync.forceCycle();
      expect(status.offline).toBe(true);
      expect(status.conflict).toBeNull();
      expect(status.pending).toBe(i + 1);
    }
    expect(git(repos.mac, 'branch', '--list', 'conflict/*')).toBe('');
    expect(git(repos.mac, 'log', '--format=%s')).toContain('ui: 1 change(s)');

    git(repos.mac, 'remote', 'set-url', 'origin', repos.origin);
    const status = await sync.forceCycle();

    expect(status.offline).toBe(false);
    expect(status.pending).toBe(0);
    expect(status.lastError).toBeNull();
    expect(status.lastPush).not.toBeNull();
    const originTodos = JSON.parse(git(repos.origin, 'show', `${BRANCH}:todos.json`));
    expect(originTodos.items).toHaveLength(3);
  });

  it('[F-026] 20 rapid local changes while hermes pushes all land with zero merge commits', async () => {
    repos = setupRepos();
    const host = createFakeHost(repos.mac);
    sync = createSync(host, { pollSeconds: NEVER, commitDebounceMs: 20 });
    sync.start();

    for (let i = 0; i < 20; i++) {
      host.addLocal(`Local item ${i}`);
      await host.flush();
      sync.notifyLocalChange();
      if (i === 10) {
        hermesPush(repos.hermes, inboxName('from-hermes', i), addCommand('Agent item'));
      }
      await sleep(15);
    }

    await sync.forceCycle();
    await sync.stop();
    const status = sync.status();
    sync = null;

    expect(status.conflict).toBeNull();
    expect(status.offline).toBe(false);
    expect(status.pending).toBe(0);
    expect(host.items).toHaveLength(21);
    expect(host.items.filter((i) => i.source.kind === 'agent')).toHaveLength(1);
    const originTodos = JSON.parse(git(repos.origin, 'show', `${BRANCH}:todos.json`));
    expect(originTodos.items).toHaveLength(21);
    expect(mergeCommitCount(repos.mac)).toBe(0);
    expect(mergeCommitCount(repos.origin)).toBe(0);
    expect(git(repos.mac, 'rev-parse', 'HEAD')).toBe(git(repos.origin, 'rev-parse', BRANCH));
    expect(git(repos.origin, 'ls-tree', '--name-only', BRANCH, 'inbox/')).not.toMatch(/\.json$/);
  });

  it('[F-026] a data dir without git or without origin runs with sync disabled', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'quickdo-nogit-'));
    const noOrigin = mkdtempSync(join(tmpdir(), 'quickdo-noorigin-'));
    try {
      for (const dir of [plain, noOrigin]) {
        mkdirSync(join(dir, 'inbox'), { recursive: true });
        writeFileSync(join(dir, 'todos.json'), `${JSON.stringify(emptyTodos(), null, 2)}\n`);
      }
      git(noOrigin, 'init', '-q');

      for (const dir of [plain, noOrigin]) {
        const host = createFakeHost(dir);
        const s = createSync(host, { pollSeconds: NEVER });
        s.start();
        host.addLocal('Read paper X');
        s.notifyLocalChange();
        const status = await s.forceCycle();
        expect(status.enabled).toBe(false);
        expect(status.cycles).toBe(0);
        expect(status.offline).toBe(false);
        expect(host.logs.some((l) => l.level === 'warn' && /sync disabled/.test(l.msg))).toBe(true);
        await s.stop();
      }
      expect(git(noOrigin, 'log', '--oneline', '--all')).toBe('');
    } finally {
      rmSync(plain, { recursive: true, force: true });
      rmSync(noOrigin, { recursive: true, force: true });
    }
  });

  it('[F-026] nothing to do leaves origin untouched and coalesces queued cycles', async () => {
    repos = setupRepos();
    const host = createFakeHost(repos.mac);
    sync = createSync(host, { pollSeconds: NEVER });
    sync.start();

    const first = await sync.forceCycle();
    const before = git(repos.origin, 'rev-parse', BRANCH);
    const [a, b, c] = await Promise.all([sync.forceCycle(), sync.forceCycle(), sync.forceCycle()]);

    expect(first.remoteSha).toBe(before);
    expect(git(repos.origin, 'rev-parse', BRANCH)).toBe(before);
    // three concurrent requests → at most two cycles (one running + one queued)
    expect(c.cycles - first.cycles).toBeLessThanOrEqual(2);
    expect(a.lastSync).not.toBeNull();
    expect(b.pending).toBe(0);
    expect(host.ingestCalls).toHaveLength(0);
  });
});
