import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStore } from '../store';
import { T } from '../testids';
import {
  item,
  jsonResponse,
  makeState,
  mockFetch,
  seedStore,
  todayItem,
} from '../testing/webFixtures';
import { Backlog } from './Backlog';
import { Upcoming } from './Upcoming';

describe('Upcoming', () => {
  beforeEach(() => resetStore());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    resetStore();
  });

  it('[F-034] items scheduled for later days are always shown next to the backlog and can be finished directly', () => {
    const fetchSpy = mockFetch(() => jsonResponse({ state: makeState([]) }));
    seedStore(
      makeState([
        todayItem({ id: 'T1', title: 'Read paper X' }),
        item({ id: 'U1', title: 'Plan the week', scheduledFor: '2026-09-21' }),
        item({ id: 'B1', title: 'Reply to alice' }),
      ]),
    );
    render(
      <>
        <Upcoming />
        <Backlog />
      </>,
    );
    const group = screen.getByTestId(T.upcomingGroup);
    expect(group.dataset.date).toBe('2026-09-21');
    expect(within(group).getByTestId(T.rowTitle).textContent).toBe('Plan the week');
    expect(within(screen.getByTestId(T.backlog)).getByTestId(T.rowTitle).textContent).toBe(
      'Reply to alice',
    );
    fireEvent.click(within(group).getByTestId(T.rowTick));
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/items/U1/done',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('[F-034] the upcoming section disappears when nothing is scheduled ahead', () => {
    seedStore(makeState([item({ id: 'B1', title: 'Reply to alice' })]));
    render(<Upcoming />);
    expect(screen.queryByTestId(T.upcoming)).toBeNull();
  });
});
