/**
 * Today list against the real built server: soft cap, progress after `x`, rollover after the
 * test clock moves to the next day (the server must apply `rollover` on the first request of a
 * new day; CONTRACTS §2 applies it on boot, PLAN §5 also "on the first activity of a new day").
 * Serial: the clock test changes server-wide state and runs last, then resets the clock.
 */
import { type APIRequestContext, expect, test } from '@playwright/test';

const HEADERS = { 'Content-Type': 'application/json', 'X-Quickdo-Client': '1' };

test.describe.configure({ mode: 'serial' });

function uniqueTitle(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`;
}

async function captureToday(request: APIRequestContext, title: string): Promise<void> {
  const res = await request.post('/api/capture', {
    headers: HEADERS,
    data: { text: `${title} !today`, source: 'cli' },
  });
  expect(res.status()).toBe(201);
}

test.describe('today', () => {
  test('[F-005] six items on Today turn the header amber and offer T', async ({
    page,
    request,
  }) => {
    for (let i = 0; i < 6; i++) await captureToday(request, uniqueTitle(`Read paper X ${i}`));
    await page.goto('/');
    const header = page.getByTestId('today-header');
    await expect(header).toHaveAttribute('data-overcap', 'true');
    await expect(header).toHaveClass(/amber/);
    await expect(header).toHaveText(/\d+ on Today — move one to tomorrow\? \(T\)/);
  });

  test('[F-008] x on a row updates the progress label and moves the row to the done section', async ({
    page,
    request,
  }) => {
    const title = uniqueTitle('Reply to alice');
    await captureToday(request, title);
    await page.goto('/');
    const row = page.getByTestId('today-row').filter({ hasText: title });
    await expect(row).toBeVisible();
    const before = await page.getByTestId('progress-label').textContent();
    const doneBefore = Number(/(\d+) done/.exec(before ?? '')?.[1] ?? 0);
    await row.click(); // moves the cursor and enters list mode
    await page.keyboard.press('x');
    await expect(page.getByTestId('progress-label')).toHaveText(
      new RegExp(`${doneBefore + 1} done`),
    );
    await expect(
      page.getByTestId('done-section').getByTestId('today-row').filter({ hasText: title }),
    ).toHaveClass(/done/);
    await expect(
      page.locator('[data-testid="progress-segment"][data-status="done"]').first(),
    ).toBeVisible();
  });

  test('[F-004] moving the clock to the next day rolls open Today items to the Backlog with a chip', async ({
    page,
    request,
  }) => {
    const title = uniqueTitle('Lecture A prep');
    await captureToday(request, title);
    const stateRes = await request.get('/api/state');
    const state = (await stateRes.json()) as { derived: { date: string } };
    const [y, m, d] = state.derived.date.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1, 7, 30, 0)); // 09:30 in Europe/Berlin (summer)
    const clockRes = await request.post('/api/_test/clock', {
      headers: HEADERS,
      data: { now: next.toISOString() },
    });
    expect(clockRes.ok()).toBe(true);
    try {
      await page.goto('/');
      const chip = page.getByTestId('rollover-chip');
      await expect(chip).toBeVisible({ timeout: 5000 });
      await expect(chip).toHaveText(/\d+ from yesterday moved to backlog \(t = today\)/);
      await expect(
        page.getByTestId('backlog').getByTestId('row').filter({ hasText: title }),
      ).toBeVisible();
      await expect(page.getByTestId('today-row').filter({ hasText: title })).toHaveCount(0);
    } finally {
      await request.post('/api/_test/clock', { headers: HEADERS, data: { now: null } });
    }
  });
});
