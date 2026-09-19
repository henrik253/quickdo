import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKeyboard } from '../App';
import { resetStore, useStore } from '../store';
import { T } from '../testids';
import {
  bodyOf,
  item,
  jsonResponse,
  makeState,
  mockFetch,
  seedStore,
  todayItem,
} from '../testing/webFixtures';
import { Backlog } from './Backlog';
import { TodayList } from './TodayList';

function Host() {
  useKeyboard();
  return (
    <>
      <TodayList />
      <Backlog />
    </>
  );
}

describe('TodayList', () => {
  beforeEach(() => {
    resetStore();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    resetStore();
  });

  it('[F-005] the header turns amber from item 6 and offers T', () => {
    const items = Array.from({ length: 6 }, (_, i) => todayItem({ title: `Read paper X ${i}` }));
    seedStore(makeState(items));
    render(<TodayList />);
    const header = screen.getByTestId(T.todayHeader);
    expect(header).toHaveClass('amber');
    expect(header.textContent).toContain('6 on Today — move one to tomorrow? (T)');
    expect(screen.getAllByTestId(T.todayRow)).toHaveLength(6);
  });

  it('[F-005] five items keep a plain header', () => {
    seedStore(makeState(Array.from({ length: 5 }, () => todayItem())));
    render(<TodayList />);
    const header = screen.getByTestId(T.todayHeader);
    expect(header).not.toHaveClass('amber');
    expect(header.textContent).toContain('Today · 5');
  });

  it('[F-004] shows the rollover chip when items came back from yesterday', () => {
    seedStore(makeState([], { rolloverCount: 3 }));
    render(<TodayList />);
    expect(screen.getByTestId(T.rolloverChip).textContent).toBe(
      '3 from yesterday moved to backlog (t = today)',
    );
  });

  it('[F-004] no rollover chip when nothing moved', () => {
    seedStore(makeState([todayItem()]));
    render(<TodayList />);
    expect(screen.queryByTestId(T.rolloverChip)).toBeNull();
  });

  it('[F-006] rows show the padded estimate and block chips', () => {
    seedStore(
      makeState([
        todayItem({
          id: 'A',
          title: 'Read paper X',
          estimateMin: 30,
          block: { start: '09:00', minutes: 40 },
          project: 'thesis',
        }),
      ]),
    );
    render(<TodayList />);
    const row = screen.getByTestId(T.todayRow);
    const chips = within(row)
      .getAllByTestId(T.rowChip)
      .map((c) => c.textContent);
    expect(chips).toEqual(expect.arrayContaining(['09:00–09:40', '40m', '#thesis']));
  });

  it('[F-008] x on the highlighted row marks it done optimistically and POSTs /api/items/:id/done', async () => {
    const fetchSpy = mockFetch(() => jsonResponse({ state: makeState([]) }));
    seedStore(makeState([todayItem({ id: 'A', title: 'Read paper X' })]));
    render(<Host />);
    act(() => {
      useStore.getState().setCursor('A');
      useStore.getState().setMode('list');
    });
    fireEvent.keyDown(document.body, { key: 'x' });
    // optimistic: the row is in the done section with strike-through before the server answers
    const done = screen.getByTestId(T.doneSection);
    expect(within(done).getByTestId(T.todayRow)).toHaveClass('done');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/items/A/done',
      expect.objectContaining({ method: 'POST' }),
    );
    await act(async () => {
      await Promise.resolve();
    });
  });

  it('[F-014] s skips with the self-forgiveness copy and POSTs skip', async () => {
    const fetchSpy = mockFetch(() => jsonResponse({ state: makeState([]) }));
    seedStore(makeState([todayItem({ id: 'A' })]));
    render(<Host />);
    act(() => {
      useStore.getState().setCursor('A');
      useStore.getState().setMode('list');
    });
    fireEvent.keyDown(document.body, { key: 's' });
    expect(screen.getByTestId(T.todayRow)).toHaveClass('skipped');
    expect(fetchSpy).toHaveBeenCalledWith('/api/items/A/skip', expect.anything());
    expect(useStore.getState().toast.map((t) => t.text)).toContain(
      'Skipped. One miss changes nothing; the next block is what counts.',
    );
    await act(async () => {
      await Promise.resolve();
    });
  });

  it('[F-004] t moves a backlog row to Today and POSTs today', async () => {
    const fetchSpy = mockFetch(() => jsonResponse({ state: makeState([]) }));
    seedStore(makeState([item({ id: 'B', title: 'Reply to alice' })]));
    render(<Host />);
    act(() => {
      useStore.getState().setCursor('B');
      useStore.getState().setMode('list');
    });
    expect(screen.queryAllByTestId(T.todayRow)).toHaveLength(0);
    fireEvent.keyDown(document.body, { key: 't' });
    expect(screen.getAllByTestId(T.todayRow)).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledWith('/api/items/B/today', expect.anything());
    await act(async () => {
      await Promise.resolve();
    });
  });

  it('[F-009] [ and ] shift the block by 15 min through PATCH', async () => {
    const fetchSpy = mockFetch(() => jsonResponse({ state: makeState([]) }));
    seedStore(makeState([todayItem({ id: 'A', block: { start: '10:00', minutes: 30 } })]));
    render(<Host />);
    act(() => {
      useStore.getState().setCursor('A');
      useStore.getState().setMode('list');
    });
    fireEvent.keyDown(document.body, { key: ']' });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/items/A',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(bodyOf(fetchSpy.mock.calls[0])).toEqual({ block: { start: '10:15', minutes: 30 } });
    await act(async () => {
      await Promise.resolve();
    });
  });

  it('[F-007] e opens an inline title editor; Enter PATCHes the title, Esc cancels', async () => {
    const fetchSpy = mockFetch(() =>
      jsonResponse({
        state: makeState([todayItem({ id: 'A', title: 'Read paper X, section 3' })]),
      }),
    );
    seedStore(makeState([todayItem({ id: 'A', title: 'Read paper X' })]));
    render(<Host />);
    act(() => {
      useStore.getState().setCursor('A');
      useStore.getState().setMode('list');
    });
    fireEvent.keyDown(document.body, { key: 'e' });
    const editor = screen.getByTestId(T.inlineEditor) as HTMLInputElement;
    expect(editor.value).toBe('Read paper X');
    fireEvent.change(editor, { target: { value: 'Read paper X, section 3' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(screen.queryByTestId(T.inlineEditor)).toBeNull();
    expect(bodyOf(fetchSpy.mock.calls[0])).toEqual({ title: 'Read paper X, section 3' });
    expect(screen.getByTestId(T.rowTitle).textContent).toBe('Read paper X, section 3');
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.keyDown(document.body, { key: 'c' });
    fireEvent.keyDown(screen.getByTestId(T.inlineEditor), { key: 'Escape' });
    expect(screen.queryByTestId(T.inlineEditor)).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('[F-015] . posts a fresh start', async () => {
    const fetchSpy = mockFetch(() => jsonResponse({ state: makeState([]) }));
    seedStore(makeState([todayItem({ id: 'A' })]));
    render(<Host />);
    act(() => useStore.getState().setMode('list'));
    fireEvent.keyDown(document.body, { key: '.' });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/day/freshStart',
      expect.objectContaining({ method: 'POST' }),
    );
    await act(async () => {
      await Promise.resolve();
    });
  });

  it('[F-027] the ✕ button removes a row optimistically and POSTs drop', async () => {
    const fetchSpy = mockFetch(() => jsonResponse({ state: makeState([]) }));
    seedStore(
      makeState([
        todayItem({ id: 'A', title: 'Read paper X' }),
        item({ id: 'B', title: 'Reply to alice' }),
      ]),
    );
    render(<Host />);
    expect(screen.getAllByTestId(T.rowRemove)).toHaveLength(2);
    fireEvent.click(within(screen.getByTestId(T.todayRow)).getByTestId(T.rowRemove));
    expect(screen.queryAllByTestId(T.todayRow)).toHaveLength(0);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/items/A/drop',
      expect.objectContaining({ method: 'POST' }),
    );
    await act(async () => {
      await Promise.resolve();
    });
  });

  it('[F-028] a row being formatted by the model shows the formatting chip', () => {
    seedStore(
      makeState([
        todayItem({
          id: 'A',
          title: 'for this and that',
          llm: { status: 'pending', raw: 'for this and that' },
        }),
        todayItem({ id: 'B', title: 'Read paper X', llm: { status: 'done', raw: 'read paper x' } }),
      ]),
    );
    render(<TodayList />);
    const chips = screen.getAllByTestId(T.rowChip).filter((c) => c.dataset.kind === 'llm');
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('formatting');
  });
});
