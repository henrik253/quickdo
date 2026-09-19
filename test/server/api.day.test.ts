import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Item } from '../../src/domain/types';
import type { StateResponse } from '../../src/server/state';
import { capture, item, makeSandbox, type Sandbox, TODAY, TOMORROW } from './helpers';

const PAST = '01PAST00000000000000000001';

let sb: Sandbox;

beforeEach(async () => {
  sb = await makeSandbox();
});
afterEach(() => sb.cleanup());

function find(state: StateResponse, id: string): Item {
  const found = state.items.find((i) => i.id === id);
  if (!found) throw new Error(`item ${id} missing`);
  return found;
}

describe('POST /api/day/freshStart', () => {
  it('[F-015] sets freshStartAt, drops past-due blocks and leaves future blocks alone', async () => {
    sb.cleanup();
    sb = await makeSandbox({
      // a block that ended before 09:12 (a bare `@8` at 09:12 would parse as tomorrow, so seed it)
      todos: [item({ id: PAST, scheduledFor: TODAY, block: { start: '08:00', minutes: 30 } })],
    });
    const past = { id: PAST };
    const future = await capture(sb, 'Read paper X @10', 'today');
    expect(future.block?.start).toBe('10:00');
    const res = await sb.post('/api/day/freshStart');
    expect(res.status).toBe(200);
    const { state } = (await res.json()) as { state: StateResponse };
    expect(state.day.freshStartAt).toBe('09:12');
    expect(find(state, past.id).block).toBeUndefined();
    expect(find(state, past.id).scheduledFor).toBe(TODAY);
    expect(find(state, future.id).block).toEqual({ start: '10:00', minutes: 40 });
    const day = JSON.parse(readFileSync(join(sb.stateDir, 'day.json'), 'utf8')) as {
      freshStartAt: string;
    };
    expect(day.freshStartAt).toBe('09:12');
  });
});

describe('POST /api/day/commit', () => {
  it('[F-019] moves the picked items to tomorrow with their cues and marks the ritual done', async () => {
    const a = await capture(sb, 'Read paper X');
    const b = await capture(sb, 'Lecture A');
    const c = await capture(sb, 'Reply to alice');
    const res = await sb.post('/api/day/commit', {
      ids: [a.id, b.id],
      cues: { [a.id]: 'after breakfast' },
    });
    expect(res.status).toBe(200);
    const { state } = (await res.json()) as { state: StateResponse };
    expect(find(state, a.id)).toMatchObject({ scheduledFor: TOMORROW, cue: 'after breakfast' });
    expect(find(state, b.id).scheduledFor).toBe(TOMORROW);
    expect(find(state, b.id).cue).toBeUndefined();
    expect(find(state, c.id).scheduledFor).toBeUndefined();
    expect(state.day.eveningRitualDone).toBe(true);
    expect(state.derived.upcoming[0]).toMatchObject({ date: TOMORROW });
    expect(existsSync(join(sb.stateDir, 'day.json'))).toBe(true);
  });

  it('[F-019] rejects a body without ids', async () => {
    expect((await sb.post('/api/day/commit', { cues: {} })).status).toBe(400);
  });
});
