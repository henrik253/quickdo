import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAFT_KEY, resetStore, useStore } from '../store';
import { T } from '../testids';
import {
  bodyOf,
  item,
  jsonResponse,
  makeState,
  mockFetch,
  seedStore,
} from '../testing/webFixtures';
import { CaptureBar } from './CaptureBar';
import { Toast } from './Toast';

describe('CaptureBar', () => {
  beforeEach(() => {
    localStorage.clear();
    seedStore(makeState([]));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    resetStore();
  });

  it('[F-001] the bar is focused on mount', () => {
    render(<CaptureBar />);
    expect(screen.getByTestId(T.captureInput)).toHaveFocus();
  });

  it('[F-001] Enter posts the capture with the client headers, clears the bar and keeps focus', async () => {
    const server = makeState([item({ id: 'SERVER1', title: 'Read paper X' })]);
    const fetchSpy = mockFetch(() =>
      jsonResponse(
        { item: server.items[0], parsed: { tokens: [], warnings: [] }, state: server },
        201,
      ),
    );
    render(<CaptureBar />);
    const input = screen.getByTestId(T.captureInput) as HTMLInputElement;
    await userEvent.type(input, 'Read paper X');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
      await Promise.resolve();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('/api/capture');
    expect(init?.method).toBe('POST');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['X-Quickdo-Client']).toBe('1');
    expect(headers['Content-Type']).toBe('application/json');
    expect(bodyOf(fetchSpy.mock.calls[0])).toMatchObject({ text: 'Read paper X', source: 'ui' });
    expect(input.value).toBe('');
    await act(async () => {
      await Promise.resolve();
    });
    expect(input).toHaveFocus();
    expect(useStore.getState().state?.items.map((it) => it.id)).toEqual(['SERVER1']);
  });

  it('[F-004] ⌘Enter posts with target today', async () => {
    const fetchSpy = mockFetch(() =>
      jsonResponse(
        { item: item(), parsed: { tokens: [], warnings: [] }, state: makeState([]) },
        201,
      ),
    );
    render(<CaptureBar />);
    const input = screen.getByTestId(T.captureInput);
    await userEvent.type(input, 'Read paper X');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
      await Promise.resolve();
    });
    expect(bodyOf(fetchSpy.mock.calls[0])).toMatchObject({ text: 'Read paper X', target: 'today' });
  });

  it('[F-001] a failed capture keeps the draft in the bar and in localStorage and shows a chip', async () => {
    mockFetch(() => jsonResponse({ error: 'boom' }, 500));
    render(
      <>
        <CaptureBar />
        <Toast />
      </>,
    );
    const input = screen.getByTestId(T.captureInput) as HTMLInputElement;
    await userEvent.type(input, 'Read paper X');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(input.value).toBe('Read paper X');
    expect(localStorage.getItem(DRAFT_KEY)).toBe('Read paper X');
    expect(screen.getByTestId(T.toastChip).textContent).toMatch(/capture failed — draft kept/);
    // the optimistic row was rolled back
    expect(useStore.getState().state?.items).toHaveLength(0);
  });

  it('[F-002] shows live chips for "!today ~30m #thesis @9"', async () => {
    render(<CaptureBar />);
    await userEvent.type(screen.getByTestId(T.captureInput), 'Read paper X !today ~30m #thesis @9');
    const chips = screen.getAllByTestId(T.captureChip).map((c) => c.textContent);
    expect(chips).toEqual(expect.arrayContaining(['Today', '40m padded', '#thesis', '09:00']));
  });

  it('[F-002] a warning becomes an amber chip', async () => {
    render(<CaptureBar />);
    await userEvent.type(screen.getByTestId(T.captureInput), 'Read paper X ~2h');
    const warn = screen
      .getAllByTestId(T.captureChip)
      .find((c) => c.getAttribute('data-kind') === 'warning');
    expect(warn?.textContent).toMatch(/split\?/);
  });

  it('[F-001] ↑ on an empty bar recalls the last capture', async () => {
    useStore.setState({ lastCapture: 'Reply to alice' });
    render(<CaptureBar />);
    const input = screen.getByTestId(T.captureInput) as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('Reply to alice');
  });

  it('[F-025] a leading ? filters instead of capturing', async () => {
    const fetchSpy = mockFetch(() => jsonResponse({}, 500));
    render(<CaptureBar />);
    const input = screen.getByTestId(T.captureInput);
    await userEvent.type(input, '?thesis');
    expect(useStore.getState().filter).toBe('thesis');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId(T.captureChip).textContent).toBe('filter: thesis');
  });

  it('[F-001] Esc on an empty bar leaves capture mode; ↓ does the same', () => {
    render(<CaptureBar />);
    const input = screen.getByTestId(T.captureInput);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(useStore.getState().mode).toBe('list');
    act(() => useStore.getState().setMode('capture'));
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(useStore.getState().mode).toBe('list');
  });
});
