/**
 * Thin git wrapper for the sync module: every command runs inside `dataDir` via simple-git with a
 * per-command timeout, `GIT_TERMINAL_PROMPT=0` and the quickdo author identity passed as `-c`
 * options (so the data repo never needs a global git config).
 */
import { simpleGit } from 'simple-git';

export interface GitRunner {
  /** Run `git <args>` in dataDir; resolves with stdout, rejects with a GitCommandError. */
  run(args: string[]): Promise<string>;
  /** Like run() but resolves with `null` instead of throwing. */
  tryRun(args: string[]): Promise<string | null>;
}

export class GitCommandError extends Error {
  readonly args: string[];
  constructor(args: string[], message: string) {
    super(message);
    this.name = 'GitCommandError';
    this.args = args;
  }
}

export interface GitRunnerOptions {
  timeoutMs: number;
  authorName: string;
  authorEmail: string;
}

export function createGitRunner(dataDir: string, opts: GitRunnerOptions): GitRunner {
  const git = simpleGit({
    baseDir: dataDir,
    binary: 'git',
    maxConcurrentProcesses: 1,
    trimmed: false,
    timeout: { block: opts.timeoutMs },
    config: [`user.name=${opts.authorName}`, `user.email=${opts.authorEmail}`],
  }).env({ ...process.env, GIT_TERMINAL_PROMPT: '0' });

  async function run(args: string[]): Promise<string> {
    try {
      return await git.raw(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new GitCommandError(args, message.trim() || `git ${args.join(' ')} failed`);
    }
  }

  return {
    run,
    async tryRun(args) {
      try {
        return await run(args);
      } catch {
        return null;
      }
    },
  };
}

const NETWORK_PATTERNS = [
  /could not read from remote/i,
  /unable to access/i,
  /could not resolve host/i,
  /connection refused/i,
  /failed to connect/i,
  /timed out/i,
  /timeout/i,
  /network is unreachable/i,
  /connection reset/i,
  /the remote end hung up/i,
  /no route to host/i,
  /ssh: connect to host/i,
  /permission denied \(publickey\)/i,
  /terminal prompts disabled/i,
  /authentication failed/i,
];

/** Heuristic: does this git failure look like "the remote is unreachable" rather than a repo problem? */
export function isNetworkError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return NETWORK_PATTERNS.some((re) => re.test(message));
}

const NON_FF_PATTERNS = [
  /non-fast-forward/i,
  /fetch first/i,
  /\[rejected\]/i,
  /failed to push some refs/i,
];

export function isNonFastForward(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return NON_FF_PATTERNS.some((re) => re.test(message));
}

/** One entry of `git status --porcelain -z`. */
export interface StatusEntry {
  index: string;
  worktree: string;
  path: string;
  from?: string;
}

/** Parse `git status --porcelain=v1 -z` output (NUL separated; renames carry the origin as a second field). */
export function parsePorcelain(raw: string): StatusEntry[] {
  const parts = raw.split('\0');
  const out: StatusEntry[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part || part.length < 4) continue;
    const entry: StatusEntry = { index: part[0], worktree: part[1], path: part.slice(3) };
    if (
      entry.index === 'R' ||
      entry.index === 'C' ||
      entry.worktree === 'R' ||
      entry.worktree === 'C'
    ) {
      entry.from = parts[i + 1];
      i += 1;
    }
    out.push(entry);
  }
  return out;
}
