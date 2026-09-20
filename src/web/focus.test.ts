import { describe, expect, it } from 'vitest';
import { type FocusContext, mapKey, nextMode } from './focus';

const base: FocusContext = {
  mode: 'list',
  pendingChord: null,
  inputEmpty: true,
  helpOpen: false,
  inlineOpen: false,
};

const capture: FocusContext = { ...base, mode: 'capture' };

describe('focus model', () => {
  it('[F-001] capture mode: Shift+Enter submits, Enter is a new line, ⌘Enter targets Today, ↑ recalls, Esc on empty leaves', () => {
    expect(mapKey(capture, { key: 'Enter' })).toEqual({ type: 'none' }); // new line
    expect(mapKey(capture, { key: 'Enter', shift: true })).toEqual({ type: 'captureSubmit' });
    expect(mapKey(capture, { key: 'Enter', meta: true })).toEqual({
      type: 'captureSubmit',
      target: 'today',
    });
    expect(mapKey(capture, { key: 'ArrowUp' })).toEqual({ type: 'recall' });
    expect(mapKey(capture, { key: 'Escape' })).toEqual({ type: 'enterList' });
    expect(mapKey(capture, { key: 'ArrowDown' })).toEqual({ type: 'enterList' });
    expect(mapKey({ ...capture, inputEmpty: false }, { key: 'Escape' })).toEqual({
      type: 'captureClear',
    });
    expect(mapKey({ ...capture, inputEmpty: false }, { key: 'ArrowDown' })).toEqual({
      type: 'none',
    });
    expect(mapKey(capture, { key: 'j' })).toEqual({ type: 'none' });
  });

  it('[F-001] mode transitions: capture ⇄ list, ritual back to list', () => {
    expect(nextMode('capture', mapKey(capture, { key: 'Escape' }))).toBe('list');
    expect(nextMode('list', mapKey(base, { key: '/' }))).toBe('capture');
    expect(nextMode('list', mapKey(base, { key: 'q' }))).toBe('capture');
    expect(nextMode('list', mapKey(base, { key: 'x' }))).toBe('list');
    expect(nextMode('list', mapKey({ ...base, pendingChord: 'g' }, { key: 'e' }))).toBe('ritual');
    expect(nextMode('ritual', mapKey({ ...base, mode: 'ritual' }, { key: 'Escape' }))).toBe('list');
    expect(nextMode('capture', mapKey(capture, { key: 'Enter' }))).toBe('capture');
  });

  it('[F-004] list mode row keys: x u s t T b n o 2 f a d +', () => {
    const rows: Array<[string, string]> = [
      ['x', 'done'],
      ['u', 'undo'],
      ['s', 'skip'],
      ['t', 'today'],
      ['T', 'tomorrow'],
      ['b', 'backlog'],
      ['n', 'next'],
      ['o', 'start'],
      ['2', 'twoMinute'],
      ['f', 'fallback'],
      ['a', 'accept'],
      ['d', 'drop'],
      ['+', 'extend'],
    ];
    for (const [key, action] of rows) {
      expect(mapKey(base, { key })).toEqual({ type: 'row', action });
    }
  });

  it('[F-009] inline editors, block shifts, fresh start, view toggle, help', () => {
    expect(mapKey(base, { key: 'e' })).toEqual({ type: 'inline', kind: 'edit' });
    expect(mapKey(base, { key: 'r' })).toEqual({ type: 'inline', kind: 'reschedule' });
    expect(mapKey(base, { key: '@' })).toEqual({ type: 'inline', kind: 'block' });
    expect(mapKey(base, { key: 'c' })).toEqual({ type: 'inline', kind: 'cue' });
    expect(mapKey(base, { key: '[' })).toEqual({ type: 'shiftBlock', minutes: -15 });
    expect(mapKey(base, { key: ']' })).toEqual({ type: 'shiftBlock', minutes: 15 });
    expect(mapKey(base, { key: '.' })).toEqual({ type: 'freshStart' });
    expect(mapKey(base, { key: 'p' })).toEqual({ type: 'toggleView' });
    expect(mapKey(base, { key: '?' })).toEqual({ type: 'toggleHelp' });
    expect(mapKey(base, { key: 'j' })).toEqual({ type: 'move', delta: 1 });
    expect(mapKey(base, { key: 'k' })).toEqual({ type: 'move', delta: -1 });
  });

  it('[F-021] help open: ? or Esc closes it, everything else is swallowed', () => {
    const help = { ...base, helpOpen: true };
    expect(mapKey(help, { key: '?' })).toEqual({ type: 'closeHelp' });
    expect(mapKey(help, { key: 'Escape' })).toEqual({ type: 'closeHelp' });
    expect(mapKey(help, { key: 'x' })).toEqual({ type: 'none' });
  });

  it('[F-022] g chords: g s syncs, g e ritual, g r review, anything else cancels', () => {
    expect(mapKey(base, { key: 'g' })).toEqual({ type: 'chord', key: 'g' });
    const chord = { ...base, pendingChord: 'g' as const };
    expect(mapKey(chord, { key: 's' })).toEqual({ type: 'sync' });
    expect(mapKey(chord, { key: 'e' })).toEqual({ type: 'ritual' });
    expect(mapKey(chord, { key: 'r' })).toEqual({ type: 'review' });
    expect(mapKey(chord, { key: 'x' })).toEqual({ type: 'cancelChord' });
  });

  it('[F-001] unbound printable keys enter capture mode with the character; modifiers and inline editors do not', () => {
    expect(mapKey(base, { key: 'q' })).toEqual({ type: 'enterCapture', insert: 'q' });
    expect(mapKey(base, { key: '/' })).toEqual({ type: 'enterCapture' });
    expect(mapKey(base, { key: 'Escape' })).toEqual({ type: 'enterCapture' });
    expect(mapKey(base, { key: 'x', meta: true })).toEqual({ type: 'none' });
    expect(mapKey(base, { key: 'Shift', shift: true })).toEqual({ type: 'none' });
    expect(mapKey({ ...base, inlineOpen: true }, { key: 'x' })).toEqual({ type: 'none' });
  });
});
