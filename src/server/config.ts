/**
 * Configuration resolution (docs/CONTRACTS.md §2). This is the ONLY module that reads process.env.
 *
 *   QUICKDO_HOME       → home for ~/.config/quickdo, ~/.local/state/quickdo, ~/.cache/quickdo (default os.homedir())
 *   QUICKDO_DATA_DIR   → data repo clone (else config.dataDir, else ~/quickdo-data)
 *   QUICKDO_STATE_DIR  → state dir override (else ~/.local/state/quickdo)
 *   QUICKDO_PORT       → port (else config.port, else 7777)
 *   QUICKDO_SYNC=off   → disable git sync
 *   QUICKDO_TEST_CLOCK=1 → enable POST /api/_test/clock
 *   QUICKDO_BUILD_SHA  → reported as buildSha by /api/version
 *   ANTHROPIC_API_KEY  → enables LLM formatting of captures (also read from <cwd>/.env, never logged)
 *   QUICKDO_LLM_MODEL  → formatting model (default claude-haiku-4-5); QUICKDO_LLM=off disables formatting
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { DEFAULT_SETTINGS, type Settings } from '../domain/types';

export type Env = Record<string, string | undefined>;

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');

export const ConfigFileSchema = z
  .object({
    dataDir: z.string().min(1).optional(),
    port: z.int().min(1).max(65535).optional(),
    timezone: z.string().min(1).optional(),
    dayStart: HHMM.optional(),
    dayEnd: HHMM.optional(),
    slackMinutes: z.int().min(0).optional(),
    eveningRitualAt: HHMM.optional(),
    todayCap: z.int().min(1).optional(),
    slipGraceMin: z.int().min(0).optional(),
    defaultEstimateMin: z.int().min(1).optional(),
    paddingFactor: z.number().min(1).optional(),
    pollSeconds: z.int().min(1).optional(),
    reminders: z
      .object({
        blockStart: z.boolean().optional(),
        checkpoint: z.boolean().optional(),
        fallback: z.boolean().optional(),
        evening: z.boolean().optional(),
      })
      .optional(),
    hermesPatExpires: z.string().optional(),
  })
  .loose();

export type ConfigFile = z.infer<typeof ConfigFileSchema>;

export interface LlmConfig {
  enabled: boolean; // false when QUICKDO_LLM=off
  model: string;
  /** Present at boot or not; the formatter re-reads .env lazily so a key added later works without a restart. */
  apiKey: string | null;
  envFile: string | null;
}

export interface Config {
  home: string;
  configPath: string;
  settings: Settings;
  dataDir: string;
  stateDir: string;
  cacheDir: string;
  port: number;
  syncEnabled: boolean;
  testClock: boolean;
  pollSeconds: number;
  reminders: { blockStart: boolean; checkpoint: boolean; fallback: boolean; evening: boolean };
  hermesPatExpires: string | null;
  /** QUICKDO_BUILD_SHA if set; index.ts falls back to the git sha, then 'dev'. */
  buildSha: string | null;
  llm: LlmConfig;
  /** Non-fatal problems found while loading (e.g. an invalid config.json, which is then ignored). */
  problems: string[];
}

/** Expand a leading `~` to `home` and make the path absolute (relative paths resolve against `home`). */
export function expandHome(p: string, home: string): string {
  if (p === '~') return home;
  if (p.startsWith('~/')) return join(home, p.slice(2));
  return isAbsolute(p) ? p : resolve(home, p);
}

function readConfigFile(path: string, problems: string[]): ConfigFile {
  if (!existsSync(path)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    problems.push(`config.json is not valid JSON (${(e as Error).message}); using defaults`);
    return {};
  }
  const parsed = ConfigFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const at = issue ? issue.path.map(String).join('.') || '$' : '$';
    problems.push(`config.json invalid at ${at}: ${issue?.message ?? 'invalid'}; using defaults`);
    return {};
  }
  return parsed.data;
}

function envPort(value: string | undefined, problems: string[]): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    problems.push(`QUICKDO_PORT "${value}" is not a valid port; ignored`);
    return undefined;
  }
  return n;
}

/** Parse a dotenv file: KEY=VALUE lines, `#` comments, optional single/double quotes. Never throws. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (value.startsWith('#')) value = '';
    else if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    out[m[1]] = value;
  }
  return out;
}

export function readDotEnv(path: string | null): Record<string, string> {
  if (!path || !existsSync(path)) return {};
  try {
    return parseDotEnv(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

export const DEFAULT_LLM_MODEL = 'claude-haiku-4-5';

/** The Anthropic key right now: real environment first, then the .env file (re-read every call, never cached). */
export function llmApiKey(envFile: string | null, env: Env = process.env): string | null {
  const fromEnv = env.ANTHROPIC_API_KEY;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  const fromFile = readDotEnv(envFile).ANTHROPIC_API_KEY;
  return fromFile !== undefined && fromFile !== '' ? fromFile : null;
}

export function loadConfig(
  env: Env = process.env,
  envFile: string | null = join(process.cwd(), '.env'),
): Config {
  const problems: string[] = [];
  // Real environment wins over .env; .env is where Henrik keeps the Anthropic key (git-ignored).
  const dotenv = readDotEnv(envFile);
  const get = (k: string): string | undefined => {
    const v = env[k];
    return v !== undefined && v !== ''
      ? v
      : dotenv[k] !== undefined && dotenv[k] !== ''
        ? dotenv[k]
        : undefined;
  };
  const home = env.QUICKDO_HOME && env.QUICKDO_HOME !== '' ? resolve(env.QUICKDO_HOME) : homedir();
  const configPath = join(home, '.config', 'quickdo', 'config.json');
  const file = readConfigFile(configPath, problems);

  const settings: Settings = {
    timezone: file.timezone ?? DEFAULT_SETTINGS.timezone,
    dayStart: file.dayStart ?? DEFAULT_SETTINGS.dayStart,
    dayEnd: file.dayEnd ?? DEFAULT_SETTINGS.dayEnd,
    slackMinutes: file.slackMinutes ?? DEFAULT_SETTINGS.slackMinutes,
    eveningRitualAt: file.eveningRitualAt ?? DEFAULT_SETTINGS.eveningRitualAt,
    todayCap: file.todayCap ?? DEFAULT_SETTINGS.todayCap,
    slipGraceMin: file.slipGraceMin ?? DEFAULT_SETTINGS.slipGraceMin,
    defaultEstimateMin: file.defaultEstimateMin ?? DEFAULT_SETTINGS.defaultEstimateMin,
    paddingFactor: file.paddingFactor ?? DEFAULT_SETTINGS.paddingFactor,
  };

  const dataDir = expandHome(env.QUICKDO_DATA_DIR || file.dataDir || '~/quickdo-data', home);
  const stateDir = expandHome(env.QUICKDO_STATE_DIR || '~/.local/state/quickdo', home);
  const cacheDir = join(home, '.cache', 'quickdo');
  const port = envPort(env.QUICKDO_PORT, problems) ?? file.port ?? 7777;
  const syncEnabled = (env.QUICKDO_SYNC ?? '').toLowerCase() !== 'off';
  const testClock = env.QUICKDO_TEST_CLOCK === '1' || env.QUICKDO_TEST_CLOCK === 'true';

  return {
    home,
    configPath,
    settings,
    dataDir,
    stateDir,
    cacheDir,
    port,
    syncEnabled,
    testClock,
    pollSeconds: file.pollSeconds ?? 60,
    reminders: {
      blockStart: file.reminders?.blockStart ?? true,
      checkpoint: file.reminders?.checkpoint ?? true,
      fallback: file.reminders?.fallback ?? true,
      evening: file.reminders?.evening ?? true,
    },
    hermesPatExpires: file.hermesPatExpires ?? null,
    buildSha: env.QUICKDO_BUILD_SHA && env.QUICKDO_BUILD_SHA !== '' ? env.QUICKDO_BUILD_SHA : null,
    llm: {
      enabled: (get('QUICKDO_LLM') ?? '').toLowerCase() !== 'off',
      model: get('QUICKDO_LLM_MODEL') ?? DEFAULT_LLM_MODEL,
      apiKey: get('ANTHROPIC_API_KEY') ?? null,
      envFile,
    },
    problems,
  };
}
