import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { T } from '../testids';
import { ProgressBar, progressLabel } from './ProgressBar';

describe('ProgressBar', () => {
  afterEach(cleanup);
  it('[F-008] renders one segment per committed Today item with its status', () => {
    render(
      <ProgressBar
        progress={{
          done: 3,
          skipped: 1,
          open: 1,
          segments: [
            { id: 'a', title: 'Read paper X', status: 'done' },
            { id: 'b', title: 'Lecture A notes', status: 'done' },
            { id: 'c', title: 'Reply to alice', status: 'done' },
            { id: 'd', title: 'Water the fern', status: 'skipped' },
            { id: 'e', title: 'Plan tomorrow', status: 'open' },
          ],
          habitsDone: 2,
          habitsDue: 2,
        }}
      />,
    );
    const segments = screen.getAllByTestId(T.progressSegment);
    expect(segments.map((s) => s.getAttribute('data-status'))).toEqual([
      'done',
      'done',
      'done',
      'skipped',
      'open',
    ]);
    expect(segments[3]).toHaveClass('skipped');
    expect(screen.getByTestId(T.progressLabel).textContent).toBe(
      '3 done · 1 skipped · 1 left · 2 of 2 habits',
    );
  });

  it('[F-008] omits the habits part when none are due', () => {
    expect(
      progressLabel({ done: 0, skipped: 0, open: 2, segments: [], habitsDone: 0, habitsDue: 0 }),
    ).toBe('0 done · 0 skipped · 2 left');
  });
});
