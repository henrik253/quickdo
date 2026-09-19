/**
 * The Hono app: security middleware, the /api endpoints (docs/CONTRACTS.md §2), SSE and static
 * serving. `createApp(deps)` builds it in-process so tests use `app.request()` without a port.
 * Handlers stay thin: parse → dispatch → respond. No process.env here.
 */
import { type Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { parseCapture } from '../domain/capture/parseCapture';
import { ItemSchema, ScheduleSchema } from '../domain/schema';
import { addDays, todayISO, toInstant } from '../domain/time';
import type {
  Action,
  EditablePatch,
  LlmFormat,
  ParsedCapture,
  Schedule,
  Settings,
} from '../domain/types';
import type { Broadcaster } from './broadcast';
import type { ServerClock } from './clock';
import { buildPatch, type Formatter } from './llm/format';
import type { Logger } from './log';
import { securityMiddleware } from './security';
import type { Store, VersionInfo } from './state';
import { mountStatic } from './static';

export interface AppDeps {
  store: Store;
  /** LLM formatting of captures (docs/ROADMAP.md); absent or unavailable → items are stored as typed. */
  formatter?: Formatter;
  /** Test hook: called when a background formatting run finished (done | failed | skipped). */
  onFormatSettled?: (id: string, status: LlmFormat['status']) => void;
  clock: ServerClock;
  settings: Settings;
  port: number;
  testClock: boolean;
  version: VersionInfo;
  log: Logger;
  broadcaster: Broadcaster;
  /** dist/web, or null when the web build is missing (a placeholder page is served then). */
  webDir: string | null;
  keepaliveMs?: number;
}

const ITEM_ACTIONS = [
  'done',
  'undo',
  'skip',
  'drop',
  'start',
  'extend',
  'today',
  'tomorrow',
  'backlog',
  'next',
  'accept',
  'clearBlock',
] as const;
export type ItemActionName = (typeof ITEM_ACTIONS)[number];

const CaptureBody = z.object({
  text: z.string(),
  target: z.enum(['today', 'backlog', 'today+slot']).optional(),
  source: z.enum(['ui', 'hotkey', 'cli']).optional(),
});

const ExtendBody = z.object({
  minutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .optional(),
});

const CommitBody = z.object({
  ids: z.array(z.string().min(1)),
  cues: z.record(z.string(), z.string()).default({}),
});

const ClockBody = z.object({ now: z.string().nullable() });

const PATCH_KEYS = [
  'title',
  'note',
  'cue',
  'fallback',
  'estimateMin',
  'block',
  'due',
  'project',
  'tags',
  'repeat',
  'order',
  'checkpoint',
  'scheduledFor',
] as const;

/** EditablePatch over JSON: `null` clears a field (except `checkpoint`, where null is a value). */
const PatchBody = ItemSchema.pick({
  title: true,
  note: true,
  cue: true,
  fallback: true,
  estimateMin: true,
  block: true,
  due: true,
  project: true,
  tags: true,
  repeat: true,
  order: true,
  checkpoint: true,
  scheduledFor: true,
})
  .partial()
  .strict();

async function readJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === '') return {};
  return JSON.parse(text);
}

function issuePath(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue ? issue.path.map(String).join('.') : '';
  return `${path || '$'}: ${issue?.message ?? 'invalid'}`;
}

function toPatch(raw: Record<string, unknown>): EditablePatch {
  const patch: Record<string, unknown> = {};
  for (const key of PATCH_KEYS) {
    if (!Object.hasOwn(raw, key)) continue;
    const value = raw[key];
    patch[key] = value === null && key !== 'checkpoint' ? undefined : value;
  }
  return patch as EditablePatch;
}

export function createApp(deps: AppDeps): Hono {
  const { store, clock, settings, broadcaster, log } = deps;
  const startedAt = Date.now();
  const app = new Hono();

  app.use('*', securityMiddleware(deps.port));
  app.use('/api/*', async (_c, next) => {
    store.rolloverIfNeeded();
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof SyntaxError) return c.json({ error: `invalid JSON: ${err.message}` }, 400);
    log('error', 'unhandled error', { path: c.req.path, error: err.message });
    return c.json({ error: err.message }, 500);
  });

  const state = () => store.stateResponse();

  function itemAction(id: string, action: ItemActionName, minutes?: number): Action {
    const today = todayISO(clock);
    switch (action) {
      case 'today':
        return { type: 'reschedule', id, to: today };
      case 'tomorrow':
        return { type: 'reschedule', id, to: addDays(today, 1) };
      case 'backlog':
        return { type: 'reschedule', id, to: null };
      case 'next':
        return { type: 'nextSlot', id };
      case 'extend':
        return minutes === undefined ? { type: 'extend', id } : { type: 'extend', id, minutes };
      default:
        return { type: action, id };
    }
  }

  // ---------- capture ----------

  app.post('/api/capture', async (c) => {
    const body = CaptureBody.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: issuePath(body.error) }, 400);
    const parsed = parseCapture(body.data.text, clock, settings);
    if (parsed.title.trim() === '') return c.json({ error: 'no title' }, 400);
    const result = store.dispatch({
      type: 'add',
      parsed,
      source: { kind: body.data.source ?? 'ui' },
      target: body.data.target,
    });
    if (!result.changed || !result.item)
      return c.json({ error: result.warning ?? 'no title' }, 400);
    let item = result.item;
    if (deps.formatter?.available()) {
      const raw = body.data.text;
      const marked = store.dispatch({
        type: 'edit',
        id: item.id,
        patch: { llm: { status: 'pending', raw } },
      });
      if (marked.changed && marked.item) item = marked.item;
      void runFormat(item.id, raw, parsed, item.updatedAt);
    }
    return c.json(
      {
        item,
        parsed: { tokens: parsed.tokens, warnings: parsed.warnings },
        state: state(),
      },
      201,
    );
  });

  /** Background formatting: never blocks the capture; parser fields win; a user edit in between wins too. */
  async function runFormat(
    id: string,
    raw: string,
    parsed: ParsedCapture,
    baseUpdatedAt: string,
  ): Promise<void> {
    const formatter = deps.formatter;
    if (!formatter) return;
    let status: LlmFormat['status'] = 'failed';
    const mark = (s: LlmFormat['status']) =>
      store.dispatch({
        type: 'edit',
        id,
        patch: { llm: { status: s, raw, at: toInstant(clock), model: formatter.model } },
      });
    try {
      const res = await formatter.format({ raw, parsed, today: todayISO(clock), tz: clock.tz });
      const current = store.findItem(id);
      if (!current || current.status === 'dropped') {
        status = 'skipped';
      } else if (current.updatedAt !== baseUpdatedAt) {
        mark('skipped');
        status = 'skipped';
      } else {
        store.dispatch({
          type: 'edit',
          id,
          patch: buildPatch(current, parsed, res, { at: toInstant(clock), model: formatter.model }),
        });
        status = 'done';
      }
    } catch (e) {
      log('warn', 'llm formatting failed', { id, error: (e as Error).message });
      const current = store.findItem(id);
      if (current && current.status !== 'dropped') mark('failed');
    } finally {
      deps.onFormatSettled?.(id, status);
    }
  }

  // ---------- items ----------

  app.post('/api/items/:id/:action', async (c) => {
    const id = c.req.param('id');
    const action = c.req.param('action') as ItemActionName;
    if (!ITEM_ACTIONS.includes(action)) return c.json({ error: `unknown action ${action}` }, 404);
    if (!store.findItem(id)) return c.json({ error: 'not_found' }, 404);
    let minutes: number | undefined;
    if (action === 'extend') {
      const body = ExtendBody.safeParse(await readJson(c));
      if (!body.success) return c.json({ error: issuePath(body.error) }, 400);
      minutes = body.data.minutes;
    }
    const result = store.dispatch(itemAction(id, action, minutes));
    if (!result.changed)
      return c.json({ warning: result.warning ?? 'unchanged', state: state() }, 409);
    return c.json({ state: state() });
  });

  app.patch('/api/items/:id', async (c) => {
    const id = c.req.param('id');
    if (!store.findItem(id)) return c.json({ error: 'not_found' }, 404);
    const raw = await readJson(c);
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return c.json({ error: '$: expected an object' }, 400);
    }
    const nullsStripped = Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).filter(
        ([k, v]) => v !== null || k === 'checkpoint',
      ),
    );
    const body = PatchBody.safeParse(nullsStripped);
    if (!body.success) return c.json({ error: issuePath(body.error) }, 400);
    const result = store.dispatch({
      type: 'edit',
      id,
      patch: toPatch(raw as Record<string, unknown>),
    });
    if (!result.changed)
      return c.json({ warning: result.warning ?? 'unchanged', state: state() }, 409);
    return c.json({ state: state() });
  });

  // ---------- day ----------

  app.post('/api/day/freshStart', async (c) => {
    await readJson(c);
    store.dispatch({ type: 'freshStart' });
    return c.json({ state: state() });
  });

  app.post('/api/day/commit', async (c) => {
    const body = CommitBody.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: issuePath(body.error) }, 400);
    store.dispatch({ type: 'commitEvening', ids: body.data.ids, cues: body.data.cues });
    return c.json({ state: state() });
  });

  // ---------- state + events ----------

  app.get('/api/state', (c) => c.json(state()));

  app.get('/api/events', (c) => {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: 'state', data: JSON.stringify(state()) });
      const unsubscribe = broadcaster.subscribe((msg) => {
        void stream.writeSSE({ event: msg.event, data: msg.data });
      });
      const keepalive = setInterval(() => {
        void stream.write(': keepalive\n\n');
      }, deps.keepaliveMs ?? 25_000);
      keepalive.unref();
      await new Promise<void>((resolve) => {
        const done = () => {
          clearInterval(keepalive);
          unsubscribe();
          resolve();
        };
        stream.onAbort(done);
        c.req.raw.signal.addEventListener('abort', done, { once: true });
      });
    });
  });

  // ---------- sync ----------

  app.post('/api/sync', async (c) => {
    await readJson(c);
    return c.json({ sync: await store.forceSync() });
  });
  app.get('/api/sync/status', (c) => c.json({ sync: store.syncStatus() }));

  // ---------- schedule ----------

  app.get('/api/schedule', (c) => c.json(store.getState().schedule));
  app.put('/api/schedule', async (c) => {
    const body = ScheduleSchema.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: issuePath(body.error) }, 400);
    store.setSchedule(body.data as Schedule);
    return c.json(store.getState().schedule);
  });

  // ---------- meta ----------

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      version: deps.version,
    }),
  );
  app.get('/api/version', (c) => c.json(deps.version));

  app.post('/api/_test/clock', async (c) => {
    if (!deps.testClock) return c.json({ error: 'not found' }, 404);
    const body = ClockBody.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: issuePath(body.error) }, 400);
    try {
      clock.setFixed(body.data.now);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    store.rolloverIfNeeded();
    broadcaster.broadcast('state', state());
    return c.json({ now: clock.fixed(), state: state() });
  });

  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

  mountStatic(app, deps.webDir);
  return app;
}
