import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStore, useStore, visibleRows } from './store';
import {
  FakeEventSource,
  installFakeEventSource,
  item,
  jsonResponse,
  makeState,
  mockFetch,
  seedStore,
  todayItem,
} from './testing/webFixtures';

describe('store', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
    installFakeEventSource();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetStore();
  });

  it('[F-003] an SSE state event replaces the whole state and marks the stream connected', () => {
    useStore.getState().connect();
    const es = FakeEventSource.last();
    expect(es.url).toBe('/api/events');
    expect(useStore.getState().connected).toBe(false);
    es.open();
    expect(useStore.getState().connected).toBe(true);
    const first = makeState([item({ id: 'A', title: 'Read paper X' })]);
    es.emit('state', first);
    expect(useStore.getState().state?.items.map((it) => it.id)).toEqual(['A']);
    const second = makeState([item({ id: 'B', title: 'Reply to alice' })]);
    es.emit('state', second);
    expect(useStore.getState().state?.items.map((it) => it.id)).toEqual(['B']);
    es.fail();
    expect(useStore.getState().connected).toBe(false);
  });

  it('[F-001] an optimistic add shows up at once and is reconciled by the server state', async () => {
    seedStore(makeState([]));
    const server = makeState([item({ id: 'SERVER1', title: 'Read paper X' })]);
    let resolve: (r: Response) => void = () => {};
    mockFetch(() => new Promise<Response>((r) => (resolve = r)));
    const p = useStore.getState().capture('Read paper X ~30m');
    const optimistic = useStore.getState().state?.items ?? [];
    expect(optimistic).toHaveLength(1);
    expect(optimistic[0].title).toBe('Read paper X');
    expect(optimistic[0].estimateMin).toBe(30);
    expect(optimistic[0].id).not.toBe('SERVER1');
    expect(useStore.getState().draft).toBe('');
    expect(useStore.getState().lastCapture).toBe('Read paper X ~30m');
    resolve(
      jsonResponse(
        { item: server.items[0], parsed: { tokens: [], warnings: [] }, state: server },
        201,
      ),
    );
    await expect(p).resolves.toBe(true);
    expect(useStore.getState().state?.items.map((it) => it.id)).toEqual(['SERVER1']);
  });

  it('[F-001] a rejected capture rolls the optimistic row back and keeps the draft', async () => {
    seedStore(makeState([]));
    mockFetch(() => jsonResponse({ error: 'no title' }, 400));
    await expect(useStore.getState().capture('Read paper X')).resolves.toBe(false);
    expect(useStore.getState().state?.items).toHaveLength(0);
    expect(useStore.getState().draft).toBe('Read paper X');
    expect(localStorage.getItem('quickdo.draft')).toBe('Read paper X');
    expect(useStore.getState().toast[0].kind).toBe('warn');
  });

  it('[F-014] skip shows the self-forgiveness copy and never a failure counter', async () => {
    seedStore(makeState([todayItem({ id: 'A' })]));
    mockFetch(() => jsonResponse({ state: makeState([]) }));
    await useStore.getState().rowAction('A', 'skip');
    const texts = useStore.getState().toast.map((t) => t.text);
    expect(texts).toContain('Skipped. One miss changes nothing; the next block is what counts.');
  });

  it('[F-004] a failed precondition shows a chip and leaves the state alone (no request)', async () => {
    const s = makeState([
      item({ id: 'A', status: 'done', completedAt: '2026-09-18T08:00:00+02:00' }),
    ]);
    seedStore(s);
    const fetchSpy = mockFetch(() => jsonResponse({ state: s }));
    await useStore.getState().rowAction('A', 'skip');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(useStore.getState().toast[0].text).toBe('already done');
    expect(useStore.getState().state?.items[0].status).toBe('done');
  });

  it('[F-004] a server 409 rolls the optimistic change back', async () => {
    const s = makeState([todayItem({ id: 'A' })]);
    seedStore(s);
    mockFetch(() => jsonResponse({ warning: 'not on Today', state: s }, 409));
    await useStore.getState().rowAction('A', 'done');
    expect(useStore.getState().state?.items[0].status).toBe('open');
    expect(useStore.getState().toast[0].text).toMatch(/done failed/);
  });

  it('[F-022] an agent SSE event toasts "Hermes added N" and a sync event updates the badge state', () => {
    seedStore(makeState([]));
    useStore.getState().connect();
    const es = FakeEventSource.last();
    es.emit('agent', { added: [item(), item()], changed: [] });
    expect(useStore.getState().toast.map((t) => t.text)).toContain('Hermes added 2');
    es.emit('sync', { ...makeState([]).sync, pending: 4 });
    expect(useStore.getState().state?.sync.pending).toBe(4);
    es.emit('update', { sha: 'abc' });
    expect(useStore.getState().updatePending).toBe(true);
  });

  it('[F-025] visibleRows orders Today, done, habits, then the view; ? filters only the lower list', () => {
    const s = makeState([
      todayItem({ id: 'T1', title: 'Read paper X' }),
      item({ id: 'B1', title: 'Reply to alice', project: 'thesis' }),
      item({ id: 'B2', title: 'Lecture A notes' }),
      item({ id: 'H1', title: 'Water the fern', repeat: 'daily' }),
      item({ id: 'U1', title: 'Plan the week', scheduledFor: '2026-09-21' }),
    ]);
    expect(visibleRows(s, 'backlog', '').map((it) => it.id)).toEqual(['T1', 'H1', 'B1', 'B2']);
    expect(visibleRows(s, 'upcoming', '').map((it) => it.id)).toEqual(['T1', 'H1', 'U1']);
    expect(visibleRows(s, 'backlog', 'thesis').map((it) => it.id)).toEqual(['T1', 'H1', 'B1']);
    seedStore(s);
    useStore.getState().setMode('list');
    expect(useStore.getState().cursor).toBe('T1');
    useStore.getState().moveCursor(1);
    expect(useStore.getState().cursor).toBe('H1');
    useStore.getState().moveCursor(-1);
    useStore.getState().moveCursor(-1);
    expect(useStore.getState().cursor).toBe('T1');
  });
});
