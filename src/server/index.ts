/**
 * Boot (docs/CONTRACTS.md §2): config → state load (migrate → validate → rollover) → sync →
 * serve dist/web + API on 127.0.0.1:<port> → sync.start() → update checker. JSON logs to stdout,
 * graceful shutdown on SIGTERM/SIGINT (flush, sync.stop(), exit 0).
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { serve } from '@hono/node-server';
import pkg from '../../package.json';
import { createApp } from './app';
import { createBroadcaster } from './broadcast';
import { createClock } from './clock';
import { loadConfig } from './config';
import { createLogger } from './log';
import { createStore } from './state';
import { createSync, type Sync } from './sync';
import { startUpdateChecker } from './update';

const execFileAsync = promisify(execFile);

async function gitHeadSha(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd,
      timeout: 5000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const sha = stdout.trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

function findWebDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, 'web'), resolve(process.cwd(), 'dist', 'web')];
  for (const dir of candidates) if (existsSync(join(dir, 'index.html'))) return dir;
  return null;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger();
  for (const p of config.problems) log('warn', p);

  const clock = createClock(config.settings.timezone);
  const gitSha = await gitHeadSha(process.cwd());
  const version = { app: pkg.version, gitSha, buildSha: config.buildSha ?? gitSha ?? 'dev' };
  const broadcaster = createBroadcaster();

  const store = createStore({
    dataDir: config.dataDir,
    stateDir: config.stateDir,
    settings: config.settings,
    clock,
    log,
    broadcaster,
    version,
    problems: config.problems,
  });
  await store.load();

  let sync: Sync | null = null;
  if (config.syncEnabled) {
    sync = createSync(store, { pollSeconds: config.pollSeconds });
    store.attachSync(sync);
  } else {
    log('info', 'git sync disabled (QUICKDO_SYNC=off)');
  }

  const webDir = findWebDir();
  if (!webDir) log('warn', 'dist/web missing; serving the placeholder page');

  const app = createApp({
    store,
    clock,
    settings: config.settings,
    port: config.port,
    testClock: config.testClock,
    version,
    log,
    broadcaster,
    webDir,
  });

  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: config.port }, (info) => {
    log('info', 'listening', {
      url: `http://127.0.0.1:${info.port}`,
      dataDir: config.dataDir,
      version,
      sync: config.syncEnabled,
      testClock: config.testClock,
    });
  });
  server.on('error', (err) => {
    log('error', 'server error', { error: (err as Error).message });
    process.exit(1);
  });

  sync?.start();

  const updater = startUpdateChecker({
    gitSha,
    enabled: config.syncEnabled,
    cwd: process.cwd(),
    lastMutationAt: () => store.lastMutationAt(),
    broadcast: (event, payload) => broadcaster.broadcast(event, payload),
    log,
  });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log('info', 'shutting down', { signal });
    updater.stop();
    server.close();
    try {
      await store.flush();
      await sync?.stop();
    } catch (e) {
      log('warn', 'shutdown error', { error: (e as Error).message });
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((e) => {
  process.stdout.write(
    `${JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'boot failed', error: (e as Error).message })}\n`,
  );
  process.exit(1);
});
