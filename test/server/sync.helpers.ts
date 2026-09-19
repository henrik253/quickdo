/**
 * Shared scaffolding for the sync tests: a bare origin, a "mac" clone (the host's dataDir) and a
 * "hermes" clone, all in os.tmpdir(), plus an in-memory SyncHost fake.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Item, TodosFile } from '../../src/domain/types';
import type { InboxFile, IngestResult, SyncHost } from '../../src/server/sync/types';

export const BRANCH = 'main';

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

function configureIdentity(cwd: string, name: string): void {
  git(cwd, 'config', 'user.name', name);
  git(cwd, 'config', 'user.email', `${name}@example.com`);
}

export function emptyTodos(): TodosFile {
  return { version: 1, updatedAt: '2026-09-18T07:00:00Z', items: [] };
}

export interface Repos {
  root: string;
  origin: string;
  mac: string;
  hermes: string;
  cleanup(): void;
}

/** bare origin.git + mac clone (todos.json, schedule.json, inbox/.keep committed) + hermes clone. */
export function setupRepos(): Repos {
  const root = mkdtempSync(join(tmpdir(), 'quickdo-sync-'));
  const origin = join(root, 'origin.git');
  const mac = join(root, 'mac');
  const hermes = join(root, 'hermes');

  git(root, 'init', '--bare', '-q', origin);
  git(origin, 'symbolic-ref', 'HEAD', `refs/heads/${BRANCH}`);

  git(root, 'clone', '-q', origin, mac);
  configureIdentity(mac, 'alice');
  git(mac, 'checkout', '-q', '-B', BRANCH);
  writeFileSync(join(mac, 'todos.json'), `${JSON.stringify(emptyTodos(), null, 2)}\n`);
  writeFileSync(
    join(mac, 'schedule.json'),
    `${JSON.stringify({ version: 1, dayStart: '08:00', dayEnd: '18:00', slackMinutes: 60, anchors: [] }, null, 2)}\n`,
  );
  mkdirSync(join(mac, 'inbox', 'rejected'), { recursive: true });
  writeFileSync(join(mac, 'inbox', '.keep'), '');
  writeFileSync(join(mac, 'inbox', 'rejected', '.keep'), '');
  git(mac, 'add', '-A');
  git(mac, 'commit', '-q', '-m', 'init: empty data repo');
  git(mac, 'push', '-q', '-u', 'origin', BRANCH);

  git(root, 'clone', '-q', origin, hermes);
  configureIdentity(hermes, 'hermes');

  return {
    root,
    origin,
    mac,
    hermes,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Hermes drops a command file into inbox/, commits and pushes (rebasing first if needed). */
export function hermesPush(hermes: string, name: string, content: string, message = 'add'): void {
  git(hermes, 'pull', '-q', '--rebase', 'origin', BRANCH);
  writeFileSync(join(hermes, 'inbox', name), content);
  git(hermes, 'add', '-A');
  git(hermes, 'commit', '-q', '-m', `hermes: ${message}`);
  git(hermes, 'push', '-q', 'origin', `HEAD:${BRANCH}`);
}

export function inboxName(slug: string, seq = 0): string {
  const stamp = `20260918T0703${String(seq).padStart(5, '0')}Z`;
  return `${stamp}-${slug}.json`;
}

export function addCommand(title: string, extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    v: 1,
    op: 'add',
    by: 'hermes',
    at: '2026-09-18T07:03:00Z',
    item: { title, ...extra },
  })}\n`;
}

export function originLog(origin: string): string[] {
  return git(origin, 'log', '--format=%s', BRANCH).split('\n').filter(Boolean);
}

export function mergeCommitCount(repo: string): number {
  const out = git(repo, 'rev-list', '--merges', '--count', BRANCH);
  return Number.parseInt(out, 10);
}

export function readTodos(dir: string): TodosFile {
  return JSON.parse(readFileSync(join(dir, 'todos.json'), 'utf8')) as TodosFile;
}

export interface FakeHost extends SyncHost {
  items: Item[];
  ingestCalls: InboxFile[][];
  reloads: number;
  emitted: Array<{ event: string; payload: unknown }>;
  logs: Array<{ level: string; msg: string }>;
  /** Add a local item to memory (the UI path); call flush() or let the sync cycle flush it. */
  addLocal(title: string): Item;
}

let seq = 0;

export function makeItem(title: string, source: Item['source']): Item {
  seq += 1;
  const ts = '2026-09-18T07:05:00Z';
  return {
    id: `01TEST${String(seq).padStart(20, '0')}`,
    title,
    status: 'open',
    tags: [],
    rescheduleCount: 0,
    order: seq,
    source,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function createFakeHost(dataDir: string): FakeHost {
  const host: FakeHost = {
    dataDir,
    items: [],
    ingestCalls: [],
    reloads: 0,
    emitted: [],
    logs: [],
    addLocal(title) {
      const item = makeItem(title, { kind: 'ui' });
      host.items.push(item);
      return item;
    },
    async reloadFromDisk() {
      host.reloads += 1;
      host.items = readTodos(dataDir).items;
    },
    async ingest(files) {
      host.ingestCalls.push(files);
      const result: IngestResult = { outcomes: [], added: [], changed: [] };
      for (const file of files) {
        const cmd = file.command;
        if (cmd.op === 'add') {
          const dup = cmd.item.dedupeKey
            ? host.items.find((i) => i.source.dedupeKey === cmd.item.dedupeKey)
            : undefined;
          if (dup) {
            result.outcomes.push({ file: file.name, ok: false, error: 'duplicate', op: 'add' });
            continue;
          }
          const item = makeItem(cmd.item.title, {
            kind: 'agent',
            by: cmd.by,
            ref: cmd.item.ref,
            dedupeKey: cmd.item.dedupeKey,
          });
          host.items.push(item);
          result.added.push(item.id);
          result.outcomes.push({ file: file.name, ok: true, itemId: item.id, op: 'add' });
        } else if (cmd.op === 'ping') {
          result.outcomes.push({ file: file.name, ok: true, op: 'ping' });
        } else {
          const target = host.items.find(
            (i) => i.id === cmd.id || (cmd.dedupeKey && i.source.dedupeKey === cmd.dedupeKey),
          );
          if (!target) {
            result.outcomes.push({ file: file.name, ok: false, error: 'not_found', op: cmd.op });
            continue;
          }
          if (cmd.op === 'update') {
            Object.assign(target, cmd.patch);
            for (const field of Object.keys(cmd.patch))
              result.changed.push({ id: target.id, field });
          } else {
            target.status = 'done';
            result.changed.push({ id: target.id, field: 'status' });
          }
          result.outcomes.push({ file: file.name, ok: true, itemId: target.id, op: cmd.op });
        }
      }
      return result;
    },
    async flush() {
      const file: TodosFile = { ...emptyTodos(), items: host.items };
      writeFileSync(join(dataDir, 'todos.json'), `${JSON.stringify(file, null, 2)}\n`);
      return ['todos.json'];
    },
    emit(event, payload) {
      host.emitted.push({ event, payload });
    },
    log(level, msg) {
      host.logs.push({ level, msg });
    },
  };
  return host;
}
