import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { expandHome, loadConfig } from '../../src/server/config';
import { tempHome } from './helpers';

const homes: string[] = [];

function home(): string {
  const h = tempHome();
  homes.push(h);
  return h;
}

function writeConfig(h: string, body: unknown): void {
  mkdirSync(join(h, '.config', 'quickdo'), { recursive: true });
  writeFileSync(
    join(h, '.config', 'quickdo', 'config.json'),
    typeof body === 'string' ? body : JSON.stringify(body),
  );
}

afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('[F-024] applies the defaults under QUICKDO_HOME when no config.json exists', () => {
    const h = home();
    const c = loadConfig({ QUICKDO_HOME: h });
    expect(c.home).toBe(h);
    expect(c.dataDir).toBe(join(h, 'quickdo-data'));
    expect(c.stateDir).toBe(join(h, '.local', 'state', 'quickdo'));
    expect(c.cacheDir).toBe(join(h, '.cache', 'quickdo'));
    expect(c.configPath).toBe(join(h, '.config', 'quickdo', 'config.json'));
    expect(c.port).toBe(7777);
    expect(c.syncEnabled).toBe(true);
    expect(c.testClock).toBe(false);
    expect(c.pollSeconds).toBe(60);
    expect(c.buildSha).toBeNull();
    expect(c.settings).toEqual({
      timezone: 'Europe/Berlin',
      dayStart: '08:00',
      dayEnd: '22:00',
      slackMinutes: 90,
      eveningRitualAt: '20:00',
      todayCap: 5,
      slipGraceMin: 10,
      defaultEstimateMin: 30,
      paddingFactor: 1.3,
    });
    expect(c.problems).toEqual([]);
  });

  it('[F-024] reads config.json and expands ~ against QUICKDO_HOME', () => {
    const h = home();
    writeConfig(h, {
      dataDir: '~/somewhere/data',
      port: 8123,
      timezone: 'UTC',
      todayCap: 3,
      pollSeconds: 15,
      reminders: { evening: false },
      hermesPatExpires: '2027-01-01',
    });
    const c = loadConfig({ QUICKDO_HOME: h });
    expect(c.dataDir).toBe(join(h, 'somewhere', 'data'));
    expect(c.port).toBe(8123);
    expect(c.settings.timezone).toBe('UTC');
    expect(c.settings.todayCap).toBe(3);
    expect(c.settings.dayStart).toBe('08:00');
    expect(c.pollSeconds).toBe(15);
    expect(c.reminders).toEqual({
      blockStart: true,
      checkpoint: true,
      fallback: true,
      evening: false,
    });
    expect(c.hermesPatExpires).toBe('2027-01-01');
  });

  it('[F-024] environment beats config.json which beats the defaults', () => {
    const h = home();
    writeConfig(h, { dataDir: '~/from-config', port: 8123 });
    const c = loadConfig({
      QUICKDO_HOME: h,
      QUICKDO_DATA_DIR: '~/from-env',
      QUICKDO_PORT: '9000',
      QUICKDO_SYNC: 'off',
      QUICKDO_TEST_CLOCK: '1',
      QUICKDO_BUILD_SHA: 'abc123',
      QUICKDO_STATE_DIR: '~/state-override',
    });
    expect(c.dataDir).toBe(join(h, 'from-env'));
    expect(c.stateDir).toBe(join(h, 'state-override'));
    expect(c.port).toBe(9000);
    expect(c.syncEnabled).toBe(false);
    expect(c.testClock).toBe(true);
    expect(c.buildSha).toBe('abc123');
  });

  it('[F-024] ignores an invalid config.json or port with a recorded problem', () => {
    const h = home();
    writeConfig(h, { port: 'seven' });
    const c = loadConfig({ QUICKDO_HOME: h, QUICKDO_PORT: '99999' });
    expect(c.port).toBe(7777);
    expect(c.problems).toHaveLength(2);
    expect(c.problems[0]).toMatch(/config\.json invalid at port/);
    expect(c.problems[1]).toMatch(/QUICKDO_PORT/);
    writeConfig(h, '{ nope');
    expect(loadConfig({ QUICKDO_HOME: h }).problems[0]).toMatch(/not valid JSON/);
  });

  it('[F-024] expandHome handles ~, ~/x, absolute and relative paths', () => {
    expect(expandHome('~', '/home/alice')).toBe('/home/alice');
    expect(expandHome('~/data', '/home/alice')).toBe('/home/alice/data');
    expect(expandHome('/srv/data', '/home/alice')).toBe('/srv/data');
    expect(expandHome('rel/data', '/home/alice')).toBe('/home/alice/rel/data');
  });
});
