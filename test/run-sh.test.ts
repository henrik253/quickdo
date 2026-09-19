/**
 * bin/run.sh in a throwaway git repo whose package.json has controllable build scripts.
 * No network: the fixture has no `origin`, so the pull step is skipped best-effort.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const RUN_SH = resolve(__dirname, '..', 'bin', 'run.sh');

function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function fixture(opts: { webOk: boolean; serverExit?: number }) {
  const root = mkdtempSync(join(tmpdir(), 'quickdo-run-'));
  const checkout = join(root, 'checkout');
  const state = join(root, 'state');
  mkdirSync(join(checkout, 'bin'), { recursive: true });
  mkdirSync(join(checkout, 'node_modules'), { recursive: true });
  // run.sh cds to $(dirname "$0")/.. so it must live in <checkout>/bin
  writeFileSync(join(checkout, 'bin', 'run.sh'), readFileSync(RUN_SH));
  const serverJs = `process.stdout.write('server ' + process.env.QUICKDO_FIXTURE_TAG); process.exit(${opts.serverExit ?? 0});`;
  writeFileSync(
    join(checkout, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      private: true,
      type: 'module',
      scripts: {
        'build:web': opts.webOk
          ? "sh -c 'mkdir -p dist.next/web && echo web > dist.next/web/index.html'"
          : "sh -c 'echo web build broken >&2; exit 1'",
        'build:server': `sh -c 'mkdir -p dist.next && printf %s ${JSON.stringify(serverJs).replace(/'/g, "'\\''")} > dist.next/server.js'`,
      },
    }),
  );
  git(checkout, 'init', '-q');
  git(checkout, '-c', 'user.name=alice', '-c', 'user.email=alice@example.com', 'add', '.');
  git(
    checkout,
    '-c',
    'user.name=alice',
    '-c',
    'user.email=alice@example.com',
    'commit',
    '-q',
    '-m',
    'fixture',
  );
  return { checkout, state, head: git(checkout, 'rev-parse', 'HEAD') };
}

function run(checkout: string, state: string, tag: string) {
  return spawnSync('bash', [join(checkout, 'bin', 'run.sh')], {
    cwd: checkout,
    encoding: 'utf8',
    env: {
      ...process.env,
      QUICKDO_STATE_DIR: state,
      QUICKDO_FIXTURE_TAG: tag,
      QUICKDO_NODE: process.execPath,
    },
    timeout: 60_000,
  });
}

describe('bin/run.sh', () => {
  it('[F-024] a failed build keeps the previous dist/ and still starts the old server', () => {
    const { checkout, state } = fixture({ webOk: false });
    mkdirSync(join(checkout, 'dist'), { recursive: true });
    writeFileSync(join(checkout, 'dist', 'server.js'), "process.stdout.write('old server')");
    const r = run(checkout, state, 'x');
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('build failed; keeping the previous dist/');
    expect(r.stdout).toContain('old server');
    expect(existsSync(join(checkout, 'dist.next'))).toBe(false);
    expect(existsSync(join(state, 'built-sha'))).toBe(false);
  });

  it('[F-024] a successful build swaps dist.next into dist, keeps dist.prev, records the sha and skips the next time', () => {
    const { checkout, state, head } = fixture({ webOk: true });
    mkdirSync(join(checkout, 'dist'), { recursive: true });
    writeFileSync(join(checkout, 'dist', 'server.js'), "process.stdout.write('old server')");

    const first = run(checkout, state, 'one');
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('build ok, swapped into dist/');
    expect(first.stdout).toContain('server one');
    expect(existsSync(join(checkout, 'dist', 'web', 'index.html'))).toBe(true);
    expect(readFileSync(join(checkout, 'dist.prev', 'server.js'), 'utf8')).toContain('old server');
    expect(existsSync(join(checkout, 'dist.next'))).toBe(false);
    expect(readFileSync(join(state, 'built-sha'), 'utf8').trim()).toBe(head);

    const second = run(checkout, state, 'two');
    expect(second.status).toBe(0);
    expect(second.stdout).not.toContain('build ok');
    expect(second.stdout).toContain('server two');
  });

  it('[F-024] the server exit code is passed through (75 = restart me, handled by launchd KeepAlive)', () => {
    const { checkout, state } = fixture({ webOk: true, serverExit: 75 });
    const r = run(checkout, state, 'x');
    expect(r.status).toBe(75);
  });
});
