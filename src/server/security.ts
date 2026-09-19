/**
 * Security middleware (docs/CONTRACTS.md §2) for every non-GET request:
 *   Content-Type must start with application/json         → 415
 *   header X-Quickdo-Client: 1 required                   → 403
 *   Host must be 127.0.0.1:<port> or localhost:<port>     → 421
 *   Origin, if present, must be http://127.0.0.1:<port> or http://localhost:<port> → 403
 * No CORS headers are ever emitted.
 */
import type { MiddlewareHandler } from 'hono';

export function securityMiddleware(port: number): MiddlewareHandler {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD') return next();

    const contentType = c.req.header('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
      return c.json({ error: 'Content-Type must be application/json' }, 415);
    }
    if (c.req.header('x-quickdo-client') !== '1') {
      return c.json({ error: 'missing X-Quickdo-Client header' }, 403);
    }
    const host = c.req.header('host') ?? new URL(c.req.url).host;
    if (!hosts.has(host)) {
      return c.json({ error: `unexpected Host ${host}` }, 421);
    }
    const origin = c.req.header('origin');
    if (origin !== undefined && !origins.has(origin)) {
      return c.json({ error: 'foreign Origin' }, 403);
    }
    return next();
  };
}
