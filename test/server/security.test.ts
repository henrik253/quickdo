import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JSON_HEADERS, makeSandbox, PORT, type Sandbox } from './helpers';

let sb: Sandbox;

afterEach(() => sb?.cleanup());

const body = JSON.stringify({ text: 'Read paper X' });

describe('security middleware', () => {
  beforeEach(async () => {
    sb = await makeSandbox();
  });

  it('[F-003] rejects a non-JSON Content-Type with 415', async () => {
    const res = await sb.app.request('/api/capture', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'content-type': 'text/plain' },
      body,
    });
    expect(res.status).toBe(415);
    expect((await sb.state()).items).toEqual([]);
  });

  it('[F-003] rejects a missing X-Quickdo-Client header with 403', async () => {
    const { 'x-quickdo-client': _drop, ...headers } = JSON_HEADERS;
    const res = await sb.app.request('/api/capture', { method: 'POST', headers, body });
    expect(res.status).toBe(403);
  });

  it('[F-003] rejects a wrong Host with 421', async () => {
    const res = await sb.app.request('/api/capture', {
      method: 'POST',
      headers: { ...JSON_HEADERS, host: 'evil.example.com' },
      body,
    });
    expect(res.status).toBe(421);
    const wrongPort = await sb.app.request('/api/capture', {
      method: 'POST',
      headers: { ...JSON_HEADERS, host: `127.0.0.1:${PORT + 1}` },
      body,
    });
    expect(wrongPort.status).toBe(421);
  });

  it('[F-003] accepts localhost:<port> as Host and a matching Origin', async () => {
    for (const host of [`localhost:${PORT}`, `127.0.0.1:${PORT}`]) {
      const res = await sb.app.request('/api/capture', {
        method: 'POST',
        headers: { ...JSON_HEADERS, host, origin: `http://${host}` },
        body,
      });
      expect(res.status, host).toBe(201);
    }
  });

  it('[F-003] rejects a foreign Origin with 403 and never sets CORS headers', async () => {
    const res = await sb.app.request('/api/capture', {
      method: 'POST',
      headers: { ...JSON_HEADERS, origin: 'https://evil.example.com' },
      body,
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const ok = await sb.post('/api/capture', { text: 'Read paper X' });
    expect(ok.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('[F-003] checks in the contract order: Content-Type before client header before Host', async () => {
    const res = await sb.app.request('/api/capture', {
      method: 'POST',
      headers: { host: 'evil.example.com' },
      body,
    });
    expect(res.status).toBe(415);
    const res2 = await sb.app.request('/api/capture', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'evil.example.com' },
      body,
    });
    expect(res2.status).toBe(403);
  });

  it('[F-003] leaves GET requests unaffected', async () => {
    const res = await sb.app.request('/api/state', { headers: { host: 'evil.example.com' } });
    expect(res.status).toBe(200);
    expect((await sb.app.request('/api/health')).status).toBe(200);
  });

  it('[F-024] hides POST /api/_test/clock without the flag (404) and serves it with the flag (200)', async () => {
    expect((await sb.post('/api/_test/clock', { now: '2026-09-19T08:00:00+02:00' })).status).toBe(
      404,
    );
    sb.cleanup();
    sb = await makeSandbox({ testClock: true });
    const res = await sb.post('/api/_test/clock', { now: '2026-09-19T08:00:00+02:00' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { now: string; state: { derived: { date: string } } };
    expect(json.state.derived.date).toBe('2026-09-19');
    const reset = await sb.post('/api/_test/clock', { now: null });
    expect(((await reset.json()) as { now: string | null }).now).toBeNull();
  });
});
