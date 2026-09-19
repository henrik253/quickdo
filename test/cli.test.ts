/**
 * bin/quickdo against a stub HTTP server (the real server is built by another module).
 * Checks the request path, headers, body and the printed output.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI = resolve(__dirname, '..', 'bin', 'quickdo');

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

const seen: Seen[] = [];
let server: Server;
let port = 0;

function run(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolvePromise) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, QUICKDO_PORT: String(port), QUICKDO_CLI_TIMEOUT_MS: '3000', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

const item = {
  id: '01JXAAAAAAAAAAAAAAAAAAAAAA',
  title: 'Read paper X',
  status: 'open',
  scheduledFor: '2026-09-20',
  tags: [],
  rescheduleCount: 0,
  order: 1,
  source: { kind: 'cli' },
  createdAt: '2026-09-19T10:00:00+02:00',
  updatedAt: '2026-09-19T10:00:00+02:00',
};

const sync = {
  enabled: true,
  lastSync: '2026-09-19T10:00:00+02:00',
  lastPush: null,
  remoteSha: 'abc',
  pending: 2,
  offline: false,
  conflict: null,
  hermesLastSeen: null,
  rejectedCount: 0,
  lastError: null,
  cycles: 3,
};

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (req.url === '/api/capture' && req.method === 'POST') {
        const parsedBody = JSON.parse(body) as { text: string };
        if (parsedBody.text.trim() === '!today') return json(400, { error: 'no title' });
        return json(201, {
          item,
          parsed: {
            tokens: [
              { kind: 'schedule', raw: '!today', value: '2026-09-20' },
              { kind: 'estimate', raw: '~30m', value: '30' },
            ],
            warnings: ['estimate over 90 min — split?'],
          },
          state: {},
        });
      }
      if (req.url === '/api/sync/status' && req.method === 'GET') return json(200, { sync });
      if (req.url === '/api/sync' && req.method === 'POST') {
        return json(200, { sync: { ...sync, cycles: 4 } });
      }
      if (req.url === '/api/health') return json(200, { ok: true, uptimeSec: 5, version: '0.1.0' });
      json(404, { error: 'not found' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('bin/quickdo', () => {
  it('[F-003] capture POSTs /api/capture with source cli, the two headers and prints title + chips', async () => {
    seen.length = 0;
    const r = await run(['Read paper X', '!today', '~30m']);
    expect(r.code).toBe(0);
    expect(seen).toHaveLength(1);
    const req = seen[0];
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/api/capture');
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.headers['x-quickdo-client']).toBe('1');
    expect(JSON.parse(req.body)).toEqual({ text: 'Read paper X !today ~30m', source: 'cli' });
    expect(r.stdout).toContain('+ Read paper X');
    expect(r.stdout).toContain('2026-09-20');
    expect(r.stdout).toContain('schedule: 2026-09-20');
    expect(r.stdout).toContain('estimate: 30');
    expect(r.stdout).toContain('! estimate over 90 min');
  });

  it('[F-003] --today sends target today', async () => {
    seen.length = 0;
    const r = await run(['--today', 'Read paper X']);
    expect(r.code).toBe(0);
    expect(JSON.parse(seen[0].body)).toEqual({
      text: 'Read paper X',
      source: 'cli',
      target: 'today',
    });
  });

  it('[F-003] a 400 from the server is reported and exits 1', async () => {
    const r = await run(['!today']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('capture failed (400): no title');
  });

  it('[F-003] no text prints usage and exits 2', async () => {
    const r = await run([]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('nothing to capture');
    expect(r.stderr).toContain('usage:');
  });

  it('[F-003] status prints the sync status from GET /api/sync/status', async () => {
    seen.length = 0;
    const r = await run(['status']);
    expect(r.code).toBe(0);
    expect(seen[0].method).toBe('GET');
    expect(seen[0].url).toBe('/api/sync/status');
    expect(r.stdout).toContain('pending commits   2');
    expect(r.stdout).toContain('cycles            3');
    expect(r.stdout).toContain('conflict          none');
  });

  it('[F-003] sync POSTs /api/sync with the headers and prints the returned status', async () => {
    seen.length = 0;
    const r = await run(['sync']);
    expect(r.code).toBe(0);
    expect(seen[0].method).toBe('POST');
    expect(seen[0].url).toBe('/api/sync');
    expect(seen[0].headers['x-quickdo-client']).toBe('1');
    expect(seen[0].headers['content-type']).toBe('application/json');
    expect(r.stdout).toContain('cycles            4');
  });

  it('[F-003] server unreachable prints one clear line and exits 1', async () => {
    const r = await run(['Read paper X', '--port', '1']);
    expect(r.code).toBe(1);
    expect(r.stderr.trim()).toBe(
      "Quickdo server is not running on 127.0.0.1:1 — run 'quickdo install' or 'npm start'",
    );
    expect(r.stdout).toBe('');
  });

  it('[F-003] port comes from QUICKDO_HOME config.json when no flag or env is set', async () => {
    const home = mkdtempSync(join(tmpdir(), 'quickdo-cli-'));
    const cfgDir = join(home, '.config', 'quickdo');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(join(cfgDir, 'config.json'), JSON.stringify({ port }));
    const r = await run(['status'], { QUICKDO_PORT: '', QUICKDO_HOME: home });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('cycles');
  });

  it('[F-003] help lists every command', async () => {
    const r = await run(['help']);
    expect(r.code).toBe(0);
    for (const c of ['status', 'sync', 'open', 'doctor', 'install', 'uninstall']) {
      expect(r.stdout).toContain(`quickdo ${c}`);
    }
  });
});
