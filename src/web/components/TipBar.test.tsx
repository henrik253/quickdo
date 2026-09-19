import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { T } from '../testids';
import { groupFor, ROTATE_MS, TIPS, TipBar } from './TipBar';

describe('TipBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('[F-021] every tip has text, a practice, a source and a known group; at least 20 tips', () => {
    expect(TIPS.length).toBeGreaterThanOrEqual(20);
    for (const tip of TIPS) {
      expect(tip.text.length).toBeGreaterThan(10);
      expect(tip.practice.length).toBeGreaterThan(2);
      expect(tip.source.length).toBeGreaterThan(3);
      expect(['planning', 'capacity', 'slip', 'habit', 'review']).toContain(tip.group);
    }
    for (const g of ['planning', 'capacity', 'slip', 'habit', 'review']) {
      expect(TIPS.filter((t) => t.group === g).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('[F-021] rotates every 10 minutes and shows the source', () => {
    render(<TipBar context={{ slips: 0, overCap: false }} />);
    const first = screen.getByTestId(T.tipText).textContent;
    expect(screen.getByTestId(T.tipSource).textContent?.length).toBeGreaterThan(3);
    expect(screen.getByTestId(T.tipBar).getAttribute('title')).toBe(
      screen.getByTestId(T.tipSource).textContent,
    );
    act(() => {
      vi.advanceTimersByTime(ROTATE_MS);
    });
    const second = screen.getByTestId(T.tipText).textContent;
    expect(second).not.toBe(first);
    act(() => {
      vi.advanceTimersByTime(ROTATE_MS - 1);
    });
    expect(screen.getByTestId(T.tipText).textContent).toBe(second);
  });

  it('[F-021] the group follows the context: slips → slip, overCap → capacity, else planning', () => {
    expect(groupFor({ slips: 1, overCap: true })).toBe('slip');
    expect(groupFor({ slips: 0, overCap: true })).toBe('capacity');
    expect(groupFor({ slips: 0, overCap: false })).toBe('planning');
    const { rerender } = render(<TipBar context={{ slips: 0, overCap: false }} />);
    expect(screen.getByTestId(T.tipBar).getAttribute('data-group')).toBe('planning');
    rerender(<TipBar context={{ slips: 2, overCap: false }} />);
    expect(screen.getByTestId(T.tipBar).getAttribute('data-group')).toBe('slip');
    const shown = screen.getByTestId(T.tipText).textContent;
    expect(TIPS.find((t) => t.text === shown)?.group).toBe('slip');
  });
});
