/**
 * RECOVERY: a rebase failed after a successful fetch (the agent broke the one-writer-per-path
 * contract) or the working tree is corrupt. Nothing is ever lost: the local HEAD is parked on a
 * conflict/<ts> branch, the tree is reset to origin, and every Mac-owned path is restored from
 * the parked branch. inbox/ stays as origin has it so the cycle can re-ingest it.
 */
import type { GitRunner } from './git';
import type { SyncHost } from './types';

export const MAC_OWNED_RESTORE = [
  'todos.json',
  'schedule.json',
  'history',
  'archive',
  'schema',
  'README.md',
] as const;

export interface RecoveryResult {
  at: string;
  branch: string;
}

export async function runRecovery(
  git: GitRunner,
  host: SyncHost,
  branch: string,
  cause: string,
): Promise<RecoveryResult> {
  const at = new Date().toISOString();
  const conflictBranch = `conflict/${at.replace(/:/g, '-')}`;
  host.log('warn', 'sync recovery: parking local history and restoring Mac-owned paths', {
    cause,
    branch: conflictBranch,
  });

  await git.tryRun(['rebase', '--abort']);
  await git.run(['branch', conflictBranch, 'HEAD']);
  await git.run(['reset', '--hard', `origin/${branch}`]);
  for (const path of MAC_OWNED_RESTORE) {
    // "did not match any file(s)" for paths the conflict branch never had — ignored on purpose.
    await git.tryRun(['checkout', conflictBranch, '--', path]);
  }
  await host.reloadFromDisk();
  const staged = await git.tryRun(['diff', '--cached', '--name-only']);
  if (staged?.trim()) {
    await git.run(['commit', '-q', '-m', 'resolve: restore Mac-owned paths after conflict']);
  }
  return { at, branch: conflictBranch };
}
