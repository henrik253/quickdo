import { describe, expect, it } from 'vitest';
import type { Item } from '../../src/domain/types';
import { makeSandbox } from './helpers';

describe('multi-line captures and sub-todos', () => {
  it('[F-031] a multi-line capture stores the heading as title, bullets as sub-todos and the rest as note', async () => {
    const sb = await makeSandbox();
    try {
      const res = await sb.post('/api/capture', {
        text: 'Prepare the thesis meeting !today #thesis\nBring the draft.\n- print the outline\n[x] book the room',
      });
      expect(res.status).toBe(201);
      const { item } = (await res.json()) as { item: Item };
      expect(item.title).toBe('Prepare the thesis meeting');
      expect(item.scheduledFor).toBe('2026-09-18');
      expect(item.project).toBe('thesis');
      expect(item.note).toBe('Bring the draft.');
      expect(item.subtasks?.map((s) => [s.title, s.done])).toEqual([
        ['print the outline', false],
        ['book the room', true],
      ]);
      expect(new Set(item.subtasks?.map((s) => s.id)).size).toBe(2);
    } finally {
      sb.cleanup();
    }
  });

  it('[F-032] PATCH can tick a sub-todo; unknown keys are still rejected', async () => {
    const sb = await makeSandbox();
    try {
      const created = (await (
        await sb.post('/api/capture', { text: 'Call alice\n- prepare questions\n- send the notes' })
      ).json()) as { item: Item };
      const [a, b] = created.item.subtasks ?? [];
      const res = await sb.patch(`/api/items/${created.item.id}`, {
        subtasks: [{ ...a, done: true }, { ...b }],
      });
      expect(res.status).toBe(200);
      const after = (await sb.state()).items.find((i) => i.id === created.item.id);
      expect(after?.subtasks?.map((s) => s.done)).toEqual([true, false]);
      const bad = await sb.patch(`/api/items/${created.item.id}`, {
        subtasks: [{ id: 'x', title: '', done: false }],
      });
      expect(bad.status).toBe(400);
    } finally {
      sb.cleanup();
    }
  });
});
