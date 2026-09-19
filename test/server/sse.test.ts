import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeSandbox, type Sandbox } from './helpers';

let sb: Sandbox;

beforeEach(async () => {
  sb = await makeSandbox();
});
afterEach(() => sb.cleanup());

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const { value, done } = await reader.read();
  if (done || !value) throw new Error('stream ended');
  return new TextDecoder().decode(value);
}

describe('GET /api/events', () => {
  it('[F-001] streams the full state as the first event', async () => {
    const res = await sb.app.request('/api/events');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    const reader = res.body!.getReader();
    const first = await readChunk(reader);
    expect(first.startsWith('event: state\n')).toBe(true);
    const data = first
      .split('\n')
      .find((l) => l.startsWith('data: '))!
      .slice(6);
    const state = JSON.parse(data) as { items: unknown[]; version: { app: string } };
    expect(state.items).toEqual([]);
    expect(state.version.app).toBe('0.1.0');
    await reader.cancel();
  });

  it('[F-001] pushes a state event after every change and stops on disconnect', async () => {
    const res = await sb.app.request('/api/events');
    const reader = res.body!.getReader();
    await readChunk(reader);
    expect(sb.broadcaster.size()).toBe(1);
    const created = await sb.post('/api/capture', { text: 'Read paper X' });
    expect(created.status).toBe(201);
    const chunk = await readChunk(reader);
    expect(chunk.startsWith('event: state\n')).toBe(true);
    expect(chunk).toContain('"Read paper X"');
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 10));
    expect(sb.broadcaster.size()).toBe(0);
  });

  it('[F-022] forwards agent / sync / update events emitted by the host', async () => {
    const res = await sb.app.request('/api/events');
    const reader = res.body!.getReader();
    await readChunk(reader);
    sb.store.emit('agent', { added: ['01X'], changed: [] });
    const chunk = await readChunk(reader);
    expect(chunk).toBe('event: agent\ndata: {"added":["01X"],"changed":[]}\n\n');
    await reader.cancel();
  });
});
