import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LLM_MODEL, llmApiKey, loadConfig, parseDotEnv } from '../../src/server/config';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempEnvFile(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'quickdo-env-'));
  dirs.push(dir);
  const path = join(dir, '.env');
  writeFileSync(path, text);
  return path;
}

describe('parseDotEnv', () => {
  it('[F-028] reads KEY=VALUE lines, quotes, comments and export prefixes', () => {
    const parsed = parseDotEnv(
      [
        '# comment',
        'ANTHROPIC_API_KEY=sk-test-123',
        'export QUICKDO_LLM_MODEL="claude-haiku-4-5"',
        "SINGLE='a b'",
        'TRAILING=value # note',
        'EMPTY=',
        'not a line',
      ].join('\n'),
    );
    expect(parsed).toEqual({
      ANTHROPIC_API_KEY: 'sk-test-123',
      QUICKDO_LLM_MODEL: 'claude-haiku-4-5',
      SINGLE: 'a b',
      TRAILING: 'value',
      EMPTY: '',
    });
  });
});

describe('loadConfig llm section', () => {
  it('[F-028] takes the key from .env when the environment has none, and the real environment wins', () => {
    const envFile = tempEnvFile('ANTHROPIC_API_KEY=from-file\nQUICKDO_LLM_MODEL=model-from-file\n');
    const fromFile = loadConfig({ QUICKDO_SYNC: 'off' }, envFile);
    expect(fromFile.llm).toEqual({
      enabled: true,
      model: 'model-from-file',
      apiKey: 'from-file',
      envFile,
    });
    const fromEnv = loadConfig({ QUICKDO_SYNC: 'off', ANTHROPIC_API_KEY: 'from-env' }, envFile);
    expect(fromEnv.llm.apiKey).toBe('from-env');
  });

  it('[F-028] defaults: no key → null, default model, enabled; QUICKDO_LLM=off disables', () => {
    const envFile = tempEnvFile('ANTHROPIC_API_KEY=\n');
    const c = loadConfig({ QUICKDO_SYNC: 'off' }, envFile);
    expect(c.llm.apiKey).toBeNull();
    expect(c.llm.model).toBe(DEFAULT_LLM_MODEL);
    expect(c.llm.enabled).toBe(true);
    const off = loadConfig({ QUICKDO_SYNC: 'off', QUICKDO_LLM: 'off' }, envFile);
    expect(off.llm.enabled).toBe(false);
    const missing = loadConfig({ QUICKDO_SYNC: 'off' }, join(tmpdir(), 'does-not-exist', '.env'));
    expect(missing.llm.apiKey).toBeNull();
  });

  it('[F-028] llmApiKey re-reads the file every call, so a key added later is picked up', () => {
    const envFile = tempEnvFile('ANTHROPIC_API_KEY=\n');
    expect(llmApiKey(envFile, {})).toBeNull();
    writeFileSync(envFile, 'ANTHROPIC_API_KEY=sk-later\n');
    expect(llmApiKey(envFile, {})).toBe('sk-later');
    expect(llmApiKey(envFile, { ANTHROPIC_API_KEY: 'sk-env' })).toBe('sk-env');
  });
});
