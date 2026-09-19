import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Item, TodosFile } from '../../src/domain/types';
import { makeSandbox, type Sandbox, TODAY } from './helpers';

let sb: Sandbox;

beforeEach(async () => {
  sb = await makeSandbox();
});
afterEach(() => sb.cleanup());

describe('POST /api/capture', () => {
  it('[F-001] returns 201 with the item, parsed chips and the full state', async () => {
    const res = await sb.post('/api/capture', { text: 'Read paper X' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      item: Item;
      parsed: { tokens: unknown[]; warnings: string[] };
      state: { items: Item[]; derived: { backlog: Item[] } };
    };
    expect(body.item.title).toBe('Read paper X');
    expect(body.item.status).toBe('open');
    expect(body.item.source).toEqual({ kind: 'ui' });
    expect(body.parsed.tokens).toEqual([]);
    expect(body.parsed.warnings).toEqual([]);
    expect(body.state.items.map((i) => i.id)).toContain(body.item.id);
    expect(body.state.derived.backlog[0]?.id).toBe(body.item.id);
  });

  it('[F-001] persists the item to todos.json atomically (2-space JSON, trailing newline, no tmp files)', async () => {
    const res = await sb.post('/api/capture', { text: 'Read paper X' });
    const { item } = (await res.json()) as { item: Item };
    const text = readFileSync(join(sb.dataDir, 'todos.json'), 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "items": [');
    const file = JSON.parse(text) as TodosFile;
    expect(file.version).toBe(1);
    expect(file.items.map((i) => i.id)).toEqual([item.id]);
    expect(readdirSync(sb.dataDir).filter((f) => f.includes('.tmp-'))).toEqual([]);
  });

  it('[F-001] appends one history line per event to history/YYYY-MM.jsonl', async () => {
    const res = await sb.post('/api/capture', { text: 'Read paper X' });
    const { item } = (await res.json()) as { item: Item };
    const path = join(sb.dataDir, 'history', '2026-09.jsonl');
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    const ev = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(ev).toMatchObject({ type: 'added', itemId: item.id, day: TODAY });
    expect(ev.ts).toBe('2026-09-18T09:12:00+02:00');
  });

  it('[F-002] returns the parsed tokens (chips) and applies them to the item', async () => {
    const res = await sb.post('/api/capture', {
      text: 'Read paper X ~45m #thesis +reading !today',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      item: Item;
      parsed: { tokens: Array<{ kind: string }>; warnings: string[] };
    };
    const kinds = body.parsed.tokens.map((t) => t.kind).sort();
    expect(kinds).toEqual(['estimate', 'project', 'schedule', 'tag']);
    expect(body.item).toMatchObject({
      title: 'Read paper X',
      estimateMin: 45,
      project: 'thesis',
      tags: ['reading'],
      scheduledFor: TODAY,
    });
  });

  it('[F-004] target "today" schedules for today; default lands in Backlog', async () => {
    const today = await sb.post('/api/capture', { text: 'Lecture A', target: 'today' });
    const backlog = await sb.post('/api/capture', { text: 'Read paper X' });
    const a = ((await today.json()) as { item: Item }).item;
    const b = ((await backlog.json()) as { item: Item }).item;
    expect(a.scheduledFor).toBe(TODAY);
    expect(b.scheduledFor).toBeUndefined();
    const state = await sb.state();
    expect(state.derived.today.map((i) => i.id)).toEqual([a.id]);
    expect(state.derived.backlog.map((i) => i.id)).toEqual([b.id]);
  });

  it('[F-004] target "today+slot" gives the item a block at the next free slot', async () => {
    const res = await sb.post('/api/capture', { text: 'Read paper X ~30m', target: 'today+slot' });
    const { item } = (await res.json()) as { item: Item };
    expect(item.scheduledFor).toBe(TODAY);
    expect(item.block).toEqual({ start: '09:15', minutes: 40 });
  });

  it('[F-003] records the source given by the CLI / hotkey', async () => {
    const res = await sb.post('/api/capture', { text: 'Read paper X', source: 'cli' });
    const { item } = (await res.json()) as { item: Item };
    expect(item.source).toEqual({ kind: 'cli' });
  });

  it('[F-001] rejects an empty title with 400 and leaves todos.json untouched', async () => {
    for (const text of ['', '   ', '~30m #thesis', '?filter only']) {
      const res = await sb.post('/api/capture', { text });
      expect(res.status, text).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('no title');
    }
    const file = JSON.parse(readFileSync(join(sb.dataDir, 'todos.json'), 'utf8')) as TodosFile;
    expect(file.items).toEqual([]);
    expect(existsSync(join(sb.dataDir, 'history', '2026-09.jsonl'))).toBe(false);
  });

  it('[F-001] rejects a malformed body with 400', async () => {
    expect((await sb.post('/api/capture', { nope: 1 })).status).toBe(400);
    const raw = await sb.app.request('/api/capture', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-quickdo-client': '1',
        host: '127.0.0.1:7799',
      },
      body: '{ not json',
    });
    expect(raw.status).toBe(400);
  });
});
