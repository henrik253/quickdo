/**
 * Inbox handling: list the agent's command files, validate them (name grammar, size, JSON,
 * schema) and move the bad ones to inbox/rejected/ with an .error.txt next to them.
 */
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { INBOX_FILENAME, validateInboxCommand } from '../../domain/schema';
import type { GitRunner } from './git';
import type { InboxFile } from './types';

export const INBOX_DIR = 'inbox';
export const REJECTED_DIR = 'inbox/rejected';
export const MAX_INBOX_BYTES = 32 * 1024;

/** Regular files directly under inbox/ (never rejected/, never .keep or other dotfiles), sorted by name. */
export async function listInboxFiles(dataDir: string): Promise<string[]> {
  try {
    const entries = await readdir(join(dataDir, INBOX_DIR), { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Files currently in inbox/rejected/, excluding .keep and the .error.txt companions. */
export async function countRejected(dataDir: string): Promise<number> {
  try {
    const entries = await readdir(join(dataDir, REJECTED_DIR), { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name !== '.keep' && !e.name.endsWith('.error.txt'))
      .length;
  } catch {
    return 0;
  }
}

export type Checked = { ok: true; file: InboxFile } | { ok: false; name: string; error: string };

/** Name grammar → size cap → JSON → schema. Never throws. */
export async function checkInboxFile(dataDir: string, name: string): Promise<Checked> {
  if (!INBOX_FILENAME.test(name)) {
    return { ok: false, name, error: `not_a_command_file: name must match ${INBOX_FILENAME}` };
  }
  const full = join(dataDir, INBOX_DIR, name);
  let size: number;
  try {
    size = (await stat(full)).size;
  } catch (err) {
    return { ok: false, name, error: `unreadable: ${(err as Error).message}` };
  }
  if (size > MAX_INBOX_BYTES) {
    return { ok: false, name, error: `too_large: ${size} bytes exceeds ${MAX_INBOX_BYTES}` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(full, 'utf8'));
  } catch (err) {
    return { ok: false, name, error: `json: ${(err as Error).message}` };
  }
  const result = validateInboxCommand(raw);
  if (!result.ok) return { ok: false, name, error: result.error };
  return { ok: true, file: { name, command: result.command } };
}

/**
 * Move inbox/<name> to inbox/rejected/<name> (git mv, falling back to a plain rename + git add
 * for untracked files) and write inbox/rejected/<name>.error.txt with the reason.
 */
export async function rejectInboxFile(
  dataDir: string,
  git: GitRunner,
  name: string,
  reason: string,
): Promise<void> {
  await mkdir(join(dataDir, REJECTED_DIR), { recursive: true });
  const from = `${INBOX_DIR}/${name}`;
  const to = `${REJECTED_DIR}/${name}`;
  const moved = await git.tryRun(['mv', '-f', '--', from, to]);
  if (moved === null) {
    await rename(join(dataDir, from), join(dataDir, to));
    await git.tryRun(['add', '-A', '--', from, to]);
  }
  const errorFile = `${to}.error.txt`;
  await writeFile(join(dataDir, errorFile), `${reason}\n`, 'utf8');
  await git.run(['add', '--', errorFile]);
}

/** `git rm` an ingested command file. */
export async function removeInboxFile(git: GitRunner, name: string): Promise<void> {
  await git.run(['rm', '-q', '-f', '--', `${INBOX_DIR}/${name}`]);
}
