/**
 * Static serving of the built web app (dist/web) with an SPA fallback to index.html for every
 * non-/api path. When the build is missing a tiny placeholder page is served instead.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Context, Hono } from 'hono';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

export const MISSING_BUILD_HTML = `<!doctype html>
<meta charset="utf-8">
<title>Quickdo</title>
<body style="font: 16px system-ui; padding: 2rem">
<p>web build missing — run <code>npm run build</code></p>
</body>
`;

function safeResolve(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const target = resolve(root, `.${normalize(`/${decoded}`)}`);
  const base = resolve(root);
  if (target !== base && !target.startsWith(base + sep)) return null;
  return target;
}

function sendFile(c: Context, file: string): Response {
  const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const body = readFileSync(file);
  const immutable = /\/assets\//.test(file.replace(/\\/g, '/'));
  return c.body(body, 200, {
    'Content-Type': type,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
}

/** Mount the static handler on `app`. `webDir` null → placeholder page. Must be registered after /api. */
export function mountStatic(app: Hono, webDir: string | null): void {
  app.get('*', (c) => {
    const path = new URL(c.req.url).pathname;
    if (path.startsWith('/api/') || path === '/api') return c.notFound();
    if (webDir === null || !existsSync(join(webDir, 'index.html'))) {
      return c.html(MISSING_BUILD_HTML, 200);
    }
    const file = safeResolve(webDir, path);
    if (file && existsSync(file) && statSync(file).isFile()) return sendFile(c, file);
    return sendFile(c, join(webDir, 'index.html'));
  });
}
