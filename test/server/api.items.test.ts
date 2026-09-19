import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Item } from '../../src/domain/types';
import type { StateResponse } from '../../src/server/state';
import { capture, item, makeSandbox, type Sandbox, TODAY, TOMORROW } from './helpers';

let sb: Sandbox;

afterEach(() => sb?.cleanup());

async function act(id: string, action: string, body?: unknown) {
  const res = await sb.post(`/api/items/${id}/${action}`, body);
  const json = (await res.json()) as { state: StateResponse; warning?: string; error?: string };
  return { status: res.status, ...json };
}

function find(state: StateResponse, id: string): Item {
  const found = state.items.find((i) => i.id === id);
  if (!found) throw new Error(`item ${id} missing`);
  return found;
}

describe('POST /api/items/:id/:action', () => {
  beforeEach(async () => {
    sb = await makeSandbox();
  });

  it('[F-008] done marks the item done and undo reopens it', async () => {
    const it1 = await capture(sb, 'Read paper X', 'today');
    const done = await act(it1.id, 'done');
    expect(done.status).toBe(200);
    expect(find(done.state, it1.id)).toMatchObject({
      status: 'done',
      completedAt: '2026-09-18T09:12:00+02:00',
    });
    expect(done.state.derived.doneToday.map((i) => i.id)).toEqual([it1.id]);
    const undo = await act(it1.id, 'undo');
    expect(undo.status).toBe(200);
    expect(find(undo.state, it1.id).status).toBe('open');
    expect(find(undo.state, it1.id).completedAt).toBeUndefined();
  });

  it('[F-014] skip and drop set the matching status', async () => {
    const a = await capture(sb, 'Read paper X', 'today');
    const b = await capture(sb, 'Lecture A');
    expect(find((await act(a.id, 'skip')).state, a.id)).toMatchObject({
      status: 'skipped',
      skippedOn: TODAY,
    });
    expect(find((await act(b.id, 'drop')).state, b.id)).toMatchObject({
      status: 'dropped',
      droppedAt: '2026-09-18T09:12:00+02:00',
    });
  });

  it('[F-017] start records startedAt for a Today item and refuses a Backlog item with 409', async () => {
    const today = await capture(sb, 'Read paper X', 'today');
    const backlog = await capture(sb, 'Lecture A');
    const ok = await act(today.id, 'start');
    expect(ok.status).toBe(200);
    expect(find(ok.state, today.id).startedAt).toBe('2026-09-18T09:12:00+02:00');
    const bad = await act(backlog.id, 'start');
    expect(bad.status).toBe(409);
    expect(bad.warning).toBe('not on Today');
    expect(bad.state.items.length).toBe(2);
  });

  it('[F-004] today / tomorrow / backlog reschedule to the right date', async () => {
    const it1 = await capture(sb, 'Read paper X');
    const today = await act(it1.id, 'today');
    expect(today.status).toBe(200);
    expect(find(today.state, it1.id).scheduledFor).toBe(TODAY);
    const tomorrow = await act(it1.id, 'tomorrow');
    expect(find(tomorrow.state, it1.id).scheduledFor).toBe(TOMORROW);
    expect(find(tomorrow.state, it1.id).rescheduleCount).toBe(1);
    const backlog = await act(it1.id, 'backlog');
    expect(find(backlog.state, it1.id).scheduledFor).toBeUndefined();
    expect(backlog.state.derived.backlog.map((i) => i.id)).toEqual([it1.id]);
  });

  it('[F-009] extend grows the block by 15 by default or by { minutes }', async () => {
    const it1 = await capture(sb, 'Read paper X ~30m @10');
    expect(it1.block).toEqual({ start: '10:00', minutes: 40 });
    const a = await act(it1.id, 'extend');
    expect(find(a.state, it1.id).block).toEqual({ start: '10:00', minutes: 55 });
    const b = await act(it1.id, 'extend', { minutes: 30 });
    expect(find(b.state, it1.id).block).toEqual({ start: '10:00', minutes: 85 });
    expect((await act(it1.id, 'extend', { minutes: 'x' })).status).toBe(400);
  });

  it('[F-009] clearBlock removes the block; a second call is a 409', async () => {
    const it1 = await capture(sb, 'Read paper X @10');
    const ok = await act(it1.id, 'clearBlock');
    expect(ok.status).toBe(200);
    expect(find(ok.state, it1.id).block).toBeUndefined();
    const again = await act(it1.id, 'clearBlock');
    expect(again.status).toBe(409);
    expect(again.warning).toBe('no block');
  });

  it('[F-013] next moves the block to the next free slot', async () => {
    const it1 = await capture(sb, 'Read paper X ~30m', 'today');
    const res = await act(it1.id, 'next');
    expect(res.status).toBe(200);
    expect(find(res.state, it1.id).block).toEqual({ start: '09:15', minutes: 40 });
  });

  it('[F-022] accept applies an agent suggestion', async () => {
    sb.cleanup();
    sb = await makeSandbox({
      todos: [
        item({
          id: '01SUGGESTED000000000000000',
          suggestedFor: TOMORROW,
          source: { kind: 'agent', by: 'hermes' },
        }),
      ],
    });
    const res = await act('01SUGGESTED000000000000000', 'accept');
    expect(res.status).toBe(200);
    const it1 = find(res.state, '01SUGGESTED000000000000000');
    expect(it1.scheduledFor).toBe(TOMORROW);
    expect(it1.suggestedFor).toBeUndefined();
    const again = await act('01SUGGESTED000000000000000', 'accept');
    expect(again.status).toBe(409);
    expect(again.warning).toBe('no suggestion');
  });

  it('[F-008] returns 409 with the warning and unchanged state on a precondition failure', async () => {
    const it1 = await capture(sb, 'Read paper X', 'today');
    await act(it1.id, 'done');
    const res = await act(it1.id, 'done');
    expect(res.status).toBe(409);
    expect(res.warning).toBe('already done');
    expect(find(res.state, it1.id).status).toBe('done');
  });

  it('[F-001] returns 404 for an unknown id and for an unknown action', async () => {
    const it1 = await capture(sb, 'Read paper X');
    expect((await sb.post('/api/items/01NOPE/done')).status).toBe(404);
    expect((await sb.post(`/api/items/${it1.id}/explode`)).status).toBe(404);
  });
});

describe('PATCH /api/items/:id', () => {
  beforeEach(async () => {
    sb = await makeSandbox();
  });

  it('[F-007] applies an editable patch (cue, estimate) and reports the change in history', async () => {
    const it1 = await capture(sb, 'Read paper X');
    const res = await sb.patch(`/api/items/${it1.id}`, { cue: 'after lunch', estimateMin: 20 });
    expect(res.status).toBe(200);
    const { state } = (await res.json()) as { state: StateResponse };
    expect(find(state, it1.id)).toMatchObject({ cue: 'after lunch', estimateMin: 20 });
    const edited = sb.store.recentHistory().find((e) => e.type === 'edited');
    expect(edited?.detail).toBe('cue,estimateMin');
  });

  it('[F-007] clears a field with null, rejects unknown keys and unknown ids', async () => {
    const it1 = await capture(sb, 'Read paper X ~30m');
    const cleared = await sb.patch(`/api/items/${it1.id}`, { estimateMin: null });
    expect(cleared.status).toBe(200);
    expect(
      find(((await cleared.json()) as { state: StateResponse }).state, it1.id).estimateMin,
    ).toBeUndefined();
    expect((await sb.patch(`/api/items/${it1.id}`, { status: 'done' })).status).toBe(400);
    expect((await sb.patch('/api/items/01NOPE', { title: 'x' })).status).toBe(404);
    const nothing = await sb.patch(`/api/items/${it1.id}`, { title: 'Read paper X' });
    expect(nothing.status).toBe(409);
  });
});
