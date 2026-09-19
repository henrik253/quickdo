/**
 * Capture flow against the real built server (docs/CONTRACTS.md §2, §4). The data dir is the one
 * playwright.config.ts hands to the server process; when it is not visible to the test worker the
 * on-disk assertion falls back to GET /api/state.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const HEADERS = { 'Content-Type': 'application/json', 'X-Quickdo-Client': '1' };

function uniqueTitle(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`;
}

test.describe('capture', () => {
  test('[F-001] page opens with the bar focused; Enter adds a row within 500 ms; it is on disk and survives a reload', async ({
    page,
    request,
  }) => {
    await page.goto('/');
    const input = page.getByTestId('capture-input');
    await expect(input).toBeFocused();

    const title = uniqueTitle('Read paper X');
    await input.fill(`${title} !today ~30m`);
    // live chips before Enter
    await expect(page.getByTestId('capture-chip').filter({ hasText: 'Today' })).toBeVisible();
    await expect(page.getByTestId('capture-chip').filter({ hasText: '40m padded' })).toBeVisible();

    await input.press('Enter');
    const row = page.getByTestId('today-row').filter({ hasText: title });
    await expect(row).toBeVisible({ timeout: 500 });
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await expect(row.getByTestId('row-chip').filter({ hasText: '40m' })).toBeVisible();

    const dataDir = process.env.QUICKDO_DATA_DIR;
    if (dataDir && existsSync(join(dataDir, 'todos.json'))) {
      await expect
        .poll(() => {
          const todos = JSON.parse(readFileSync(join(dataDir, 'todos.json'), 'utf8')) as {
            items: Array<{ title: string; estimateMin?: number }>;
          };
          return todos.items.find((it) => it.title === title)?.estimateMin;
        })
        .toBe(30);
    } else {
      const res = await request.get('/api/state');
      expect(res.ok()).toBe(true);
      const state = (await res.json()) as { items: Array<{ title: string; estimateMin?: number }> };
      expect(state.items.find((it) => it.title === title)?.estimateMin).toBe(30);
    }

    await page.reload();
    await expect(page.getByTestId('today-row').filter({ hasText: title })).toBeVisible();
    await expect(page.getByTestId('capture-input')).toBeFocused();
  });

  test('[F-003] a capture posted from outside appears via SSE without a reload', async ({
    page,
    request,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('capture-input')).toBeFocused();
    const title = uniqueTitle('Reply to alice');
    const res = await request.post('/api/capture', {
      headers: HEADERS,
      data: { text: `${title} !today`, source: 'cli' },
    });
    expect(res.status()).toBe(201);
    await expect(page.getByTestId('today-row').filter({ hasText: title })).toBeVisible({
      timeout: 5000,
    });
  });

  test('[F-001] a capture without target lands in the Backlog', async ({ page }) => {
    await page.goto('/');
    const title = uniqueTitle('Lecture A notes');
    await page.getByTestId('capture-input').fill(title);
    await page.getByTestId('capture-input').press('Enter');
    const backlog = page.getByTestId('backlog');
    await expect(backlog.getByTestId('row').filter({ hasText: title })).toBeVisible();
    await expect(page.getByTestId('today-row').filter({ hasText: title })).toHaveCount(0);
  });
});
