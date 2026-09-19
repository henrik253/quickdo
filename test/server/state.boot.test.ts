import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TodosFile } from '../../src/domain/types';
import { FIXED_NOW, item, makeSandbox, type Sandbox, TODAY, YESTERDAY } from './helpers';

let sb: Sandbox;

afterEach(() => sb?.cleanup());

function readTodos(dir: string): TodosFile {
  return JSON.parse(readFileSync(join(dir, 'todos.json'), 'utf8')) as TodosFile;
}

describe('state boot', () => {
  it('[F-004] creates an empty todos.json, schedule.json and the history dir when missing', async () => {
    sb = await makeSandbox();
    const todos = readTodos(sb.dataDir);
    expect(todos).toMatchObject({ version: 1, items: [] });
    expect(todos.updatedAt).toBe('2026-09-18T09:12:00+02:00');
    expect(existsSync(join(sb.dataDir, 'schedule.json'))).toBe(true);
    expect(existsSync(join(sb.dataDir, 'history'))).toBe(true);
    expect(sb.store.problems()).toEqual([]);
    const state = await sb.state();
    expect(state.items).toEqual([]);
    expect(state.rolloverCount).toBe(0);
    expect(state.day.date).toBe(TODAY);
  });

  it('[F-004] keeps invalid JSON aside as todos.json.invalid-<ts>, reports a problem, starts empty', async () => {
    sb = await makeSandbox({ todos: '{ "version": 1, "items": [ oops' });
    const kept = readdirSync(sb.dataDir).filter((f) => f.startsWith('todos.json.invalid-'));
    expect(kept).toEqual(['todos.json.invalid-20260918T071200Z']);
    expect(readFileSync(join(sb.dataDir, kept[0]!), 'utf8')).toContain('oops');
    expect(readTodos(sb.dataDir).items).toEqual([]);
    const state = await sb.state();
    expect(state.items).toEqual([]);
    expect(state.problems[0]).toMatch(
      /^todos\.json invalid at \$: .*\(kept as todos\.json\.invalid-/,
    );
    expect(state.problems[1]).toMatch(/starting empty/);
  });

  it('[F-004] reports the JSON path for a schema violation', async () => {
    sb = await makeSandbox({
      todos: JSON.stringify({
        version: 1,
        updatedAt: '2026-09-17T20:00:00+02:00',
        items: [item(), { ...item(), title: '' }],
      }),
    });
    expect(sb.store.problems()[0]).toMatch(/^todos\.json invalid at items\[1\]\.title/);
    expect((await sb.state()).items).toEqual([]);
  });

  it('[F-004] loads the last committed todos.json when the working copy is invalid', async () => {
    sb = await makeSandbox({ noLoad: true });
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: sb.dataDir, stdio: 'pipe' }).toString();
    git('init', '-q');
    git('config', 'user.email', 'alice@example.com');
    git('config', 'user.name', 'alice');
    const good: TodosFile = {
      version: 1,
      updatedAt: '2026-09-17T20:00:00+02:00',
      items: [item({ id: '01COMMITTED000000000000000', title: 'Read paper X' })],
    };
    writeFileSync(join(sb.dataDir, 'todos.json'), `${JSON.stringify(good, null, 2)}\n`);
    git('add', 'todos.json');
    git('commit', '-q', '-m', 'seed');
    writeFileSync(join(sb.dataDir, 'todos.json'), 'not json at all');
    await sb.store.load();
    const state = await sb.state();
    expect(state.items.map((i) => i.id)).toEqual(['01COMMITTED000000000000000']);
    expect(state.problems[1]).toMatch(/last committed/);
    expect(readTodos(sb.dataDir).items).toHaveLength(1);
  });

  it("[F-004] rollover on boot moves yesterday's open items to Backlog and sets rolloverCount", async () => {
    sb = await makeSandbox({
      todos: [
        item({
          id: '01STALE0000000000000000001',
          scheduledFor: YESTERDAY,
          block: { start: '10:00', minutes: 30 },
        }),
        item({ id: '01STALE0000000000000000002', scheduledFor: '2026-09-10' }),
        item({ id: '01DONE00000000000000000001', scheduledFor: YESTERDAY, status: 'done' }),
        item({ id: '01TODAY0000000000000000001', scheduledFor: TODAY }),
        item({ id: '01HABIT0000000000000000001', scheduledFor: YESTERDAY, repeat: 'daily' }),
        item({ id: '01FUTURE000000000000000001', scheduledFor: '2026-09-25' }),
      ],
    });
    const state = await sb.state();
    expect(state.rolloverCount).toBe(2);
    expect(state.day).toEqual({ date: TODAY, freshStartAt: null, eveningRitualDone: false });
    const byId = new Map(state.items.map((i) => [i.id, i]));
    for (const id of ['01STALE0000000000000000001', '01STALE0000000000000000002']) {
      expect(byId.get(id)?.scheduledFor).toBeUndefined();
      expect(byId.get(id)?.block).toBeUndefined();
      expect(byId.get(id)?.rescheduleCount).toBe(1);
    }
    expect(byId.get('01DONE00000000000000000001')?.scheduledFor).toBe(YESTERDAY);
    expect(byId.get('01TODAY0000000000000000001')?.scheduledFor).toBe(TODAY);
    expect(byId.get('01HABIT0000000000000000001')?.scheduledFor).toBe(YESTERDAY);
    expect(byId.get('01FUTURE000000000000000001')?.scheduledFor).toBe('2026-09-25');
    expect(state.derived.backlog.map((i) => i.id)).toEqual([
      '01STALE0000000000000000001',
      '01STALE0000000000000000002',
    ]);
    // persisted: todos.json, history and day.json all reflect the rollover
    expect(
      readTodos(sb.dataDir).items.find((i) => i.id === '01STALE0000000000000000001')?.scheduledFor,
    ).toBeUndefined();
    const lines = readFileSync(join(sb.dataDir, 'history', '2026-09.jsonl'), 'utf8')
      .trimEnd()
      .split('\n')
      .map((l) => JSON.parse(l) as { type: string; reason?: string });
    expect(lines.filter((e) => e.type === 'rescheduled' && e.reason === 'rollover')).toHaveLength(
      2,
    );
    expect(JSON.parse(readFileSync(join(sb.stateDir, 'day.json'), 'utf8'))).toMatchObject({
      date: TODAY,
    });
  });

  it('[F-004] a later day boundary triggers the rollover on the next request', async () => {
    sb = await makeSandbox({ testClock: true });
    const res = await sb.post('/api/capture', { text: 'Read paper X', target: 'today' });
    const { item: created } = (await res.json()) as { item: { id: string } };
    expect((await sb.state()).rolloverCount).toBe(0);
    sb.clock.setFixed('2026-09-19T08:00:00+02:00');
    const state = await sb.state();
    expect(state.day.date).toBe('2026-09-19');
    expect(state.rolloverCount).toBe(1);
    expect(state.items.find((i) => i.id === created.id)?.scheduledFor).toBeUndefined();
  });

  it('[F-018] loads this month and last month of history so habits know doneToday', async () => {
    const home = await makeSandbox({ noLoad: true });
    sb = home;
    mkdirSync(join(sb.dataDir, 'history'), { recursive: true });
    writeFileSync(
      join(sb.dataDir, 'history', '2026-09.jsonl'),
      [
        JSON.stringify({
          ts: '2026-09-18T08:00:00+02:00',
          type: 'done',
          day: TODAY,
          itemId: '01HABIT0000000000000000001',
        }),
        'this line is garbage',
        JSON.stringify({
          ts: '2026-09-17T08:00:00+02:00',
          type: 'done',
          day: YESTERDAY,
          itemId: '01HABIT0000000000000000002',
        }),
      ].join('\n') + '\n',
    );
    writeFileSync(
      join(sb.dataDir, 'history', '2026-08.jsonl'),
      `${JSON.stringify({ ts: '2026-08-31T08:00:00+02:00', type: 'added', day: '2026-08-31' })}\n`,
    );
    writeFileSync(
      join(sb.dataDir, 'history', '2026-07.jsonl'),
      `${JSON.stringify({ ts: '2026-07-31T08:00:00+02:00', type: 'added', day: '2026-07-31' })}\n`,
    );
    writeFileSync(
      join(sb.dataDir, 'todos.json'),
      JSON.stringify({
        version: 1,
        updatedAt: '2026-09-17T20:00:00+02:00',
        items: [
          item({
            id: '01HABIT0000000000000000001',
            repeat: 'daily',
            createdAt: '2026-09-01T08:00:00+02:00',
          }),
          item({
            id: '01HABIT0000000000000000002',
            repeat: 'daily',
            createdAt: '2026-09-01T08:00:00+02:00',
          }),
        ],
      }),
    );
    await sb.store.load();
    expect(sb.store.recentHistory().map((e) => e.day)).toEqual(['2026-08-31', TODAY, YESTERDAY]);
    const state = await sb.state();
    const habits = new Map(state.derived.habits.map((h) => [h.item.id, h]));
    expect(habits.get('01HABIT0000000000000000001')?.doneToday).toBe(true);
    expect(habits.get('01HABIT0000000000000000002')?.doneToday).toBe(false);
    expect(habits.get('01HABIT0000000000000000002')?.missedYesterday).toBe(false);
    expect(habits.get('01HABIT0000000000000000001')?.missedYesterday).toBe(true);
  });

  it('[F-012] falls back to the default schedule when schedule.json is invalid', async () => {
    sb = await makeSandbox({ schedule: '{"version": 1}' });
    const state = await sb.state();
    expect(state.schedule).toMatchObject({
      version: 1,
      dayStart: '08:00',
      dayEnd: '22:00',
      anchors: [],
    });
    expect(state.problems[0]).toMatch(/^schedule\.json invalid at/);
  });

  it('[F-028] an item left in llm pending by a restart is marked failed on boot, keeping the raw text', async () => {
    const sb = await makeSandbox({
      todos: [
        {
          id: '01K5G3ZQ8H0000000000000009',
          title: 'call alice',
          status: 'open',
          tags: [],
          rescheduleCount: 0,
          order: 0,
          source: { kind: 'ui' },
          createdAt: FIXED_NOW,
          updatedAt: FIXED_NOW,
          llm: { status: 'pending', raw: 'call alice' },
        },
      ],
    });
    try {
      const it0 = (await sb.state()).items[0];
      expect(it0.llm).toEqual({ status: 'failed', raw: 'call alice' });
    } finally {
      sb.cleanup();
    }
  });
});
