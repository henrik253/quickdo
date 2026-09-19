import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { T } from '../testids';
import { SlipBanner } from './SlipBanner';

describe('SlipBanner', () => {
  afterEach(cleanup);
  it('[F-013] the not-started banner offers 2 o n f T s and dispatches the matching actions', () => {
    const onAction = vi.fn();
    render(<SlipBanner kind="notStarted" onAction={onAction} />);
    const banner = screen.getByTestId(T.slipBanner);
    expect(banner.textContent).toContain('not started — ');
    expect(banner.textContent).toContain(
      '2 start · o on it · n next slot · f fallback · T tomorrow · s skip',
    );
    for (const [key, action] of [
      ['2', 'twoMinute'],
      ['o', 'start'],
      ['n', 'next'],
      ['f', 'fallback'],
      ['T', 'tomorrow'],
      ['s', 'skip'],
    ] as const) {
      fireEvent.keyDown(banner, { key });
      expect(onAction).toHaveBeenLastCalledWith(action);
    }
    expect(onAction).toHaveBeenCalledTimes(6);
  });

  it('[F-013] the overran banner offers + and x', () => {
    const onAction = vi.fn();
    render(<SlipBanner kind="overran" onAction={onAction} />);
    const banner = screen.getByTestId(T.slipBanner);
    expect(banner.textContent).toContain('still on it? + 15 min · x done');
    fireEvent.keyDown(banner, { key: '+' });
    expect(onAction).toHaveBeenLastCalledWith('extend');
    fireEvent.keyDown(banner, { key: 'x' });
    expect(onAction).toHaveBeenLastCalledWith('done');
  });

  it('[F-013] the buttons work with the mouse and unbound keys do nothing', () => {
    const onAction = vi.fn();
    render(<SlipBanner kind="notStarted" onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'n next slot' }));
    expect(onAction).toHaveBeenCalledWith('next');
    fireEvent.keyDown(screen.getByTestId(T.slipBanner), { key: 'z' });
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
