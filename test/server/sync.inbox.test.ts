/**
 * Inbox ingest through the sync module: valid files are ingested and removed, bad ones end in
 * inbox/rejected/ with an .error.txt, and the host's own outcomes (duplicate, not_found) reject too.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSync, type Sync } from '../../src/server/sync';
import { MAX_INBOX_BYTES } from '../../src/server/sync/inbox';
import {
  addCommand,
  BRANCH,
  createFakeHost,
  git,
  inboxName,
  originLog,
  type Repos,
  setupRepos,
} from './sync.helpers';

const FIXTURES = resolve(__dirname, '..', 'fixtures', 'inbox');
const NEVER = 60 * 60 * 24;

let repos: Repos | null = null;
let sync: Sync | null = null;

afterEach(async () => {
  await sync?.stop();
  sync = null;
  repos?.cleanup();
  repos = null;
});

function fixture(kind: 'valid' | 'invalid', name: string): string {
  return readFileSync(join(FIXTURES, kind, name), 'utf8');
}

/** Hermes drops several files into inbox/ in one commit and pushes. */
function hermesPushMany(hermes: string, files: Array<[string, string]>): void {
  git(hermes, 'pull', '-q', '--rebase', 'origin', BRANCH);
  for (const [name, content] of files) writeFileSync(join(hermes, 'inbox', name), content);
  git(hermes, 'add', '-A');
  git(hermes, 'commit', '-q', '-m', 'hermes: batch');
  git(hermes, 'push', '-q', 'origin', `HEAD:${BRANCH}`);
}

function rejectedFiles(mac: string): string[] {
  return readdirSync(join(mac, 'inbox', 'rejected'))
    .filter((n) => n !== '.keep')
    .sort();
}

function errorText(mac: string, name: string): string {
  return readFileSync(join(mac, 'inbox', 'rejected', `${name}.error.txt`), 'utf8');
}

describe('sync.inbox', () => {
  it('[F-026] bad inbox files are rejected with an error file while valid siblings are ingested', async () => {
    repos = setupRepos();
    const host = createFakeHost(repos.mac);
    sync = createSync(host, { pollSeconds: NEVER });
    sync.start();

    const valid = inboxName('valid-add', 1);
    const notJson = inboxName('not-json', 2);
    const badSchema = inboxName('unknown-key', 3);
    const badName = 'bad-name.json';
    const oversize = inboxName('oversize', 4);
    const ping = inboxName('ping', 5);
    const bigTitle = 'x'.repeat(MAX_INBOX_BYTES + 100);
    hermesPushMany(repos.hermes, [
      [valid, fixture('valid', 'add.json')],
      [notJson, fixture('invalid', 'not-json.txt')],
      [badSchema, fixture('invalid', 'unknown-key.json')],
      [badName, fixture('valid', 'add.json')],
      [oversize, addCommand(bigTitle)],
      [ping, fixture('valid', 'ping.json')],
    ]);

    const status = await sync.forceCycle();

    expect(status.conflict).toBeNull();
    expect(status.offline).toBe(false);
    expect(status.rejectedCount).toBe(4);
    expect(status.hermesLastSeen).toBe('2026-09-18T07:04:00Z');
    expect(host.items.map((i) => i.title)).toEqual(['Reply to alice about the meeting slot']);
    expect(host.ingestCalls[0].map((f) => f.name)).toEqual([valid, ping]);

    expect(rejectedFiles(repos.mac)).toEqual(
      [badName, notJson, badSchema, oversize].flatMap((n) => [n, `${n}.error.txt`]).sort(),
    );
    expect(errorText(repos.mac, notJson)).toMatch(/^json:/);
    expect(errorText(repos.mac, badSchema)).toMatch(/^schema: item: /);
    expect(errorText(repos.mac, badName)).toMatch(/^not_a_command_file/);
    expect(errorText(repos.mac, oversize)).toMatch(/^too_large/);

    // inbox/ only keeps .keep; the rejects and error files are committed and pushed
    expect(readdirSync(join(repos.mac, 'inbox')).sort()).toEqual(['.keep', 'rejected']);
    expect(git(repos.mac, 'status', '--porcelain')).toBe('');
    const originRejected = git(repos.origin, 'ls-tree', '--name-only', BRANCH, 'inbox/rejected/');
    expect(originRejected).toContain(`inbox/rejected/${notJson}.error.txt`);
    expect(originRejected).toContain(`inbox/rejected/${badName}`);
    expect(git(repos.origin, 'ls-tree', '--name-only', BRANCH, 'inbox/')).not.toContain(valid);
    expect(originLog(repos.origin)[0]).toBe('ingest: 2 from hermes (4 rejected)');
    expect(status.pending).toBe(0);
  });

  it('[F-026] host outcomes reject duplicates and missing targets with the reported error', async () => {
    repos = setupRepos();
    const host = createFakeHost(repos.mac);
    sync = createSync(host, { pollSeconds: NEVER });
    sync.start();

    const first = inboxName('first', 1);
    const dup = inboxName('dup', 2);
    const orphan = inboxName('orphan', 3);
    hermesPushMany(repos.hermes, [
      [first, addCommand('Read paper X', { dedupeKey: 'paper-x' })],
      [dup, addCommand('Read paper X again', { dedupeKey: 'paper-x' })],
      [orphan, fixture('invalid', 'update-without-target.json')],
    ]);

    const status = await sync.forceCycle();

    expect(host.items.map((i) => i.title)).toEqual(['Read paper X']);
    expect(status.rejectedCount).toBe(2);
    expect(errorText(repos.mac, dup)).toBe('duplicate\n');
    expect(errorText(repos.mac, orphan)).toMatch(/^schema: id: either id or dedupeKey/);
    expect(existsSync(join(repos.mac, 'inbox', first))).toBe(false);
    expect(originLog(repos.origin)[0]).toBe('ingest: 1 from hermes (2 rejected)');

    // a later update against the ingested item goes through and emits changed
    const update = inboxName('update', 4);
    hermesPushMany(repos.hermes, [
      [
        update,
        `${JSON.stringify({
          v: 1,
          op: 'update',
          by: 'hermes',
          at: '2026-09-18T08:00:00Z',
          dedupeKey: 'paper-x',
          patch: { tags: ['reading'] },
        })}\n`,
      ],
    ]);
    const after = await sync.forceCycle();
    expect(after.rejectedCount).toBe(2);
    expect(after.hermesLastSeen).toBe('2026-09-18T08:00:00Z');
    expect(host.items[0].tags).toEqual(['reading']);
    const agent = host.emitted.filter((e) => e.event === 'agent').at(-1);
    expect(agent?.payload).toEqual({
      added: [],
      changed: [{ id: host.items[0].id, field: 'tags' }],
    });
  });

  it('[F-026] an empty inbox with an unchanged remote runs no ingest', async () => {
    repos = setupRepos();
    const host = createFakeHost(repos.mac);
    sync = createSync(host, { pollSeconds: NEVER });
    sync.start();

    await sync.forceCycle();
    const status = await sync.forceCycle();

    expect(host.ingestCalls).toHaveLength(0);
    expect(status.rejectedCount).toBe(0);
    expect(status.hermesLastSeen).toBeNull();
    expect(originLog(repos.origin)).toEqual(['init: empty data repo']);
  });
});
