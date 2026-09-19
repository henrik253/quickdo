/**
 * PWA shell (F-024): the manifest is installable, a service worker registers in prompt mode, and
 * `/api/*` is never answered from the service-worker cache (vite.config.ts denylists it).
 */
import { expect, test } from '@playwright/test';

test.describe('pwa', () => {
  test('[F-024] the manifest is served with icons and display standalone', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok()).toBe(true);
    const manifest = (await res.json()) as {
      name: string;
      display: string;
      start_url: string;
      icons: Array<{ src: string; sizes: string; purpose?: string }>;
    };
    expect(manifest.name).toBe('Quickdo');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.icons.map((i) => i.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    );
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      const png = await request.get(icon.src);
      expect(png.ok()).toBe(true);
      expect(png.headers()['content-type']).toContain('image/png');
    }
  });

  test('[F-024] a service worker registers and /api/state is never served from its cache', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    const workerPromise = context
      .waitForEvent('serviceworker', { timeout: 15_000 })
      .catch(() => null);
    const state = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return reg.active?.state ?? null;
    });
    expect(['activated', 'activating']).toContain(state);
    await workerPromise;

    // A navigation after activation goes through the worker; the API request must not.
    const responsePromise = page.waitForResponse((r) => r.url().endsWith('/api/state'));
    await page.reload();
    const apiResponse = await responsePromise;
    expect(apiResponse.fromServiceWorker()).toBe(false);

    const cachedApi = await page.evaluate(async () => {
      const keys = await caches.keys();
      for (const key of keys) {
        const cache = await caches.open(key);
        const hit = await cache.match('/api/state', { ignoreSearch: true });
        if (hit) return key;
      }
      return null;
    });
    expect(cachedApi).toBeNull();

    // The shell itself is precached so the app opens while the server restarts.
    const shellCached = await page.evaluate(async () => {
      const keys = await caches.keys();
      for (const key of keys) {
        const cache = await caches.open(key);
        const entries = await cache.keys();
        if (entries.some((req) => /index\.html|\/$/.test(new URL(req.url).pathname))) return true;
      }
      return false;
    });
    expect(shellCached).toBe(true);
  });
});
