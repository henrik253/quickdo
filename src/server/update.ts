/**
 * Self-update check: every 30 min compare `origin/stable` with the sha the running build came from
 * (QUICKDO_BUILD_SHA from bin/run.sh, else git HEAD). When it moved
 * and the user has been idle for 2 min, exit with code 75 ("restart me": bin/run.sh rebuilds and
 * launchd restarts). Otherwise announce it once over SSE (`update` { sha }). Silent on failure.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Logger } from './log';

const execFileAsync = promisify(execFile);

export const IDLE_MS = 2 * 60 * 1000;
export const CHECK_INTERVAL_MS = 30 * 60 * 1000;

export interface UpdateCheckerOptions {
  /** The commit the running build was made from (falls back to git HEAD in index.ts). */
  gitSha: string | null;
  enabled: boolean;
  cwd: string;
  lastMutationAt: () => number | null;
  broadcast: (event: 'update', payload: { sha: string }) => void;
  log: Logger;
  branch?: string;
  intervalMs?: number;
  exit?: (code: number) => void;
  lsRemote?: (cwd: string, branch: string) => Promise<string | null>;
  now?: () => number;
}

export interface UpdateChecker {
  checkNow(): Promise<void>;
  stop(): void;
}

/** `git ls-remote origin refs/heads/<branch>` → sha, or null on any failure (no repo, no origin, offline). */
export async function gitLsRemote(cwd: string, branch: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['ls-remote', 'origin', `refs/heads/${branch}`], {
      cwd,
      timeout: 15_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const sha = stdout.trim().split(/\s+/)[0];
    return sha && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

export function startUpdateChecker(opts: UpdateCheckerOptions): UpdateChecker {
  const branch = opts.branch ?? 'stable';
  const lsRemote = opts.lsRemote ?? gitLsRemote;
  const now = opts.now ?? Date.now;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  let announced: string | null = null;
  let running = false;

  async function checkNow(): Promise<void> {
    if (!opts.enabled || !opts.gitSha || running) return;
    running = true;
    try {
      const sha = await lsRemote(opts.cwd, branch);
      if (!sha || sha === opts.gitSha) return;
      const last = opts.lastMutationAt();
      const idle = last === null || now() - last >= IDLE_MS;
      if (idle) {
        opts.log('info', 'update available and idle; exiting 75 for restart', {
          from: opts.gitSha,
          to: sha,
        });
        exit(75);
        return;
      }
      if (announced !== sha) {
        announced = sha;
        opts.log('info', 'update available; user active, announced', { sha });
        opts.broadcast('update', { sha });
      }
    } catch {
      // silent by design
    } finally {
      running = false;
    }
  }

  const timer = opts.enabled
    ? setInterval(() => {
        void checkNow();
      }, opts.intervalMs ?? CHECK_INTERVAL_MS)
    : null;
  timer?.unref();

  return {
    checkNow,
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
