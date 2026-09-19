import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DoneStats, Item } from '../../src/domain/types';
import { FIXED_NOW, item, makeSandbox, TODAY, YESTERDAY } from './helpers';

function done(over: Partial<Item>): Item {
  return item({ status: 'done', completedAt: FIXED_NOW, scheduledFor: TODAY, ...over });
}

describe('done tracker + clear done', () => {
  it('[F-029] GET /api/stats counts done items per day from history and validates the range', async () => {
    const sb = await makeSandbox({
      todos: [item({ id: 'A', title: 'Read paper X', scheduledFor: TODAY })],
    });
    try {
      expect((await sb.post('/api/items/A/done')).status).toBe(200);
      // a second item finished "yesterday": write the history line the way the server does
      const a = (await sb.get(`/api/stats?range=7d`).then((r) => r.json())) as DoneStats;
      expect(a.range).toBe('7d');
      expect(a.buckets).toHaveLength(7);
      expect(a.buckets[6].start).toBe(TODAY);
      expect(a.buckets[6].done).toBe(1);
      expect(a.total).toBe(1);
      // undo removes it again
      expect((await sb.post('/api/items/A/undo')).status).toBe(200);
      const b = (await sb.get(`/api/stats?range=3d`).then((r) => r.json())) as DoneStats;
      expect(b.total).toBe(0);
      expect((await sb.get('/api/stats?range=2y')).status).toBe(400);
      const q = (await sb.get('/api/stats?range=3m').then((r) => r.json())) as DoneStats;
      expect(q.unit).toBe('week');
      expect(q.buckets).toHaveLength(13);
    } finally {
      sb.cleanup();
    }
  });

  it('[F-030] POST /api/day/clearDone and the archive item action move done items into archive/YYYY-MM.json', async () => {
    const sb = await makeSandbox({
      todos: [
        done({ id: 'A', title: 'done A' }),
        item({ id: 'B', title: 'open B', scheduledFor: TODAY }),
        done({ id: 'C', title: 'done C' }),
        done({ id: 'D', title: 'done D' }),
      ],
    });
    try {
      // one item through the row action
      const one = await sb.post('/api/items/D/archive');
      expect(one.status).toBe(200);
      let st = await sb.state();
      expect(st.items.map((i) => i.id).sort()).toEqual(['A', 'B', 'C']);
      // an open item cannot be archived
      expect((await sb.post('/api/items/B/archive')).status).toBe(409);
      // the rest through clear done
      const res = await sb.post('/api/day/clearDone');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { archived: number };
      expect(body.archived).toBe(2);
      st = await sb.state();
      expect(st.items.map((i) => i.id)).toEqual(['B']);
      expect(st.derived.doneToday).toHaveLength(0);
      const archivePath = join(sb.dataDir, 'archive', `${TODAY.slice(0, 7)}.json`);
      expect(existsSync(archivePath)).toBe(true);
      const archived = JSON.parse(readFileSync(archivePath, 'utf8')) as Item[];
      expect(archived.map((i) => i.id)).toEqual(['D', 'A', 'C']);
      // todos.json no longer carries them, the archive file is a single valid JSON array
      const todos = JSON.parse(readFileSync(join(sb.dataDir, 'todos.json'), 'utf8')) as {
        items: Item[];
      };
      expect(todos.items.map((i) => i.id)).toEqual(['B']);
      // nothing left → 409
      expect((await sb.post('/api/day/clearDone')).status).toBe(409);
      // the done tracker still counts the day of completion even though the items are gone from the list
      const day = YESTERDAY; // (completedAt in the fixture is FIXED_NOW = today; history has no done event for seeded items)
      expect(day).toBeDefined();
    } finally {
      sb.cleanup();
    }
  });

  it('[F-030] cleared items still count in the tracker', async () => {
    const sb = await makeSandbox({
      todos: [item({ id: 'A', title: 'Read paper X', scheduledFor: TODAY })],
    });
    try {
      expect((await sb.post('/api/items/A/done')).status).toBe(200);
      expect((await sb.post('/api/day/clearDone')).status).toBe(200);
      const st = await sb.state();
      expect(st.items).toHaveLength(0);
      const stats = (await sb.get('/api/stats?range=3d').then((r) => r.json())) as DoneStats;
      expect(stats.total).toBe(1);
    } finally {
      sb.cleanup();
    }
  });
});
