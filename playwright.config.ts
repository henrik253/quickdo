import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Runs the REAL built server (dist/server.js — run `npm run build` first) against a throwaway
// home + data dir, git sync disabled, test clock enabled. Nothing personal is ever touched.
const home = mkdtempSync(join(tmpdir(), 'quickdo-e2e-'));
const port = 7791;

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'node dist/server.js',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 20_000,
    env: {
      QUICKDO_HOME: home,
      QUICKDO_DATA_DIR: join(home, 'data'),
      QUICKDO_PORT: String(port),
      QUICKDO_SYNC: 'off',
      QUICKDO_TEST_CLOCK: '1',
    },
  },
});
