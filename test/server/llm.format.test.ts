import { describe, expect, it } from 'vitest';
import { parseCapture } from '../../src/domain/capture/parseCapture';
import { DEFAULT_SETTINGS, type Item, type LlmFormat } from '../../src/domain/types';
import {
  buildPatch,
  buildUserMessage,
  type FormatResult,
  type Formatter,
} from '../../src/server/llm/format';
import { FIXED_NOW, makeSandbox, TODAY } from './helpers';

const clock = { now: () => new Date(FIXED_NOW), tz: 'Europe/Berlin' };

function fakeFormatter(
  impl: (raw: string) => Promise<FormatResult> | FormatResult,
  available = true,
): Formatter & { calls: string[] } {
  const calls: string[] = [];
  return {
    model: 'fake-model',
    calls,
    available: () => available,
    format: async ({ raw }) => {
      calls.push(raw);
      return impl(raw);
    },
  };
}

const RESULT: FormatResult = {
  title: 'Change the config for the export until Friday',
  note: 'From the meeting with alice',
  due: '2026-09-25',
  scheduledFor: null,
  estimateMin: 20,
  project: null,
  tags: ['config'],
  cue: null,
};

function item(over: Partial<Item> = {}): Item {
  return {
    id: '01K5G3ZQ8H0000000000000001',
    title: 'for this and that this will need to be changed until friday',
    status: 'open',
    tags: [],
    rescheduleCount: 0,
    order: 0,
    source: { kind: 'ui' },
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    llm: { status: 'pending', raw: 'for this and that this will need to be changed until friday' },
    ...over,
  };
}

describe('buildPatch', () => {
  it('[F-028] rewrites the title, fills empty fields and marks the item done', () => {
    const it0 = item();
    const parsed = parseCapture(it0.title, clock, DEFAULT_SETTINGS);
    const patch = buildPatch(it0, parsed, RESULT, { at: FIXED_NOW, model: 'm' });
    expect(patch.title).toBe(RESULT.title);
    expect(patch.note).toBe(RESULT.note);
    expect(patch.due).toBe('2026-09-25');
    expect(patch.estimateMin).toBe(20);
    expect(patch.tags).toEqual(['config']);
    expect(patch.scheduledFor).toBeUndefined();
    expect(patch.llm).toEqual({ status: 'done', raw: it0.llm?.raw, at: FIXED_NOW, model: 'm' });
  });

  it('[F-028] parser-extracted fields win over the model', () => {
    const raw = 'reply to alice !today ~10m #mail due mon';
    const parsed = parseCapture(raw, clock, DEFAULT_SETTINGS);
    const it0 = item({
      title: parsed.title,
      scheduledFor: parsed.scheduledFor,
      estimateMin: parsed.estimateMin,
      project: parsed.project,
      due: parsed.due,
      llm: { status: 'pending', raw },
    });
    const patch = buildPatch(
      it0,
      parsed,
      {
        ...RESULT,
        scheduledFor: '2026-09-30',
        due: '2026-10-01',
        estimateMin: 90,
        project: 'other',
      },
      { at: FIXED_NOW, model: 'm' },
    );
    expect(patch.scheduledFor).toBeUndefined();
    expect(patch.due).toBeUndefined();
    expect(patch.estimateMin).toBeUndefined();
    expect(patch.project).toBeUndefined();
  });

  it('[F-028] keeps the title when the model returns nothing usable and never invents dates', () => {
    const it0 = item();
    const parsed = parseCapture(it0.title, clock, DEFAULT_SETTINGS);
    const patch = buildPatch(
      it0,
      parsed,
      { ...RESULT, title: '   ', due: 'next friday', scheduledFor: '2020-01-01', tags: [] },
      { at: FIXED_NOW, model: 'm' },
    );
    expect(patch.title).toBeUndefined();
    expect(patch.due).toBeUndefined();
    expect(patch.scheduledFor).toBeUndefined();
    expect(patch.tags).toBeUndefined();
  });

  it('[F-028] the user message carries today, the extracted fields and the raw text', () => {
    const raw = 'read paper X !today ~30m';
    const parsed = parseCapture(raw, clock, DEFAULT_SETTINGS);
    const msg = buildUserMessage({ raw, parsed, today: TODAY, tz: 'Europe/Berlin' });
    expect(msg).toContain(`TODAY: ${TODAY} (fri)`);
    expect(msg).toContain('scheduledFor=2026-09-18');
    expect(msg).toContain('estimateMin=30');
    expect(msg).toContain('TEXT AS TYPED: read paper X !today ~30m');
  });
});

describe('POST /api/capture with a formatter', () => {
  function settle(): {
    promise: Promise<[string, LlmFormat['status']]>;
    cb: (id: string, s: LlmFormat['status']) => void;
  } {
    let cb: (id: string, s: LlmFormat['status']) => void = () => {};
    const promise = new Promise<[string, LlmFormat['status']]>((resolve) => {
      cb = (id, s) => resolve([id, s]);
    });
    return { promise, cb };
  }

  it('[F-028] stores the item immediately as pending, then applies the formatted fields', async () => {
    const f = fakeFormatter(() => RESULT);
    const { promise, cb } = settle();
    const sb = await makeSandbox({ formatter: f, onFormatSettled: cb });
    try {
      const res = await sb.post('/api/capture', {
        text: 'for this and that this will need to be changed until friday',
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { item: Item };
      expect(body.item.llm?.status).toBe('pending');
      expect(body.item.title).toBe('for this and that this will need to be changed until friday');
      const [id, status] = await promise;
      expect(id).toBe(body.item.id);
      expect(status).toBe('done');
      const after = (await sb.state()).items.find((i) => i.id === id);
      expect(after?.title).toBe(RESULT.title);
      expect(after?.due).toBe('2026-09-25');
      expect(after?.llm?.status).toBe('done');
      expect(after?.llm?.raw).toBe('for this and that this will need to be changed until friday');
      expect(f.calls).toHaveLength(1);
    } finally {
      sb.cleanup();
    }
  });

  it('[F-028] a failing model leaves the item as typed and marks it failed', async () => {
    const f = fakeFormatter(() => Promise.reject(new Error('boom')));
    const { promise, cb } = settle();
    const sb = await makeSandbox({ formatter: f, onFormatSettled: cb });
    try {
      const res = await sb.post('/api/capture', { text: 'call alice' });
      const body = (await res.json()) as { item: Item };
      const [, status] = await promise;
      expect(status).toBe('failed');
      const after = (await sb.state()).items.find((i) => i.id === body.item.id);
      expect(after?.title).toBe('call alice');
      expect(after?.llm?.status).toBe('failed');
    } finally {
      sb.cleanup();
    }
  });

  it('[F-028] a user edit before the model answers wins; the result is skipped', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const f = fakeFormatter(async () => {
      await gate;
      return RESULT;
    });
    const { promise, cb } = settle();
    const sb = await makeSandbox({ formatter: f, onFormatSettled: cb });
    try {
      const res = await sb.post('/api/capture', { text: 'call alice' });
      const body = (await res.json()) as { item: Item };
      sb.clock.setFixed('2026-09-18T09:13:00+02:00');
      const edit = await sb.patch(`/api/items/${body.item.id}`, {
        title: 'Call alice about Friday',
      });
      expect(edit.status).toBe(200);
      release();
      const [, status] = await promise;
      expect(status).toBe('skipped');
      const after = (await sb.state()).items.find((i) => i.id === body.item.id);
      expect(after?.title).toBe('Call alice about Friday');
      expect(after?.llm?.status).toBe('skipped');
    } finally {
      sb.cleanup();
    }
  });

  it('[F-028] no llm field at all when the formatter is unavailable (no key)', async () => {
    const f = fakeFormatter(() => RESULT, false);
    const sb = await makeSandbox({ formatter: f });
    try {
      const res = await sb.post('/api/capture', { text: 'call alice' });
      const body = (await res.json()) as { item: Item };
      expect(body.item.llm).toBeUndefined();
      expect(f.calls).toHaveLength(0);
    } finally {
      sb.cleanup();
    }
  });
});
