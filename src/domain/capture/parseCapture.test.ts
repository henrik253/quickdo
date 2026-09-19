import { describe, expect, it } from 'vitest';
import { clock, clockAt, settings } from '../testing/fixtures';
import type { Clock, ParsedCapture } from '../types';
import { parseCapture } from './parseCapture';

type Expect = Partial<Omit<ParsedCapture, 'tokens' | 'warnings'>> & {
  tokens?: number;
  tokenKinds?: string[];
  warnings?: string[];
};

interface Case {
  name: string;
  text: string;
  clock?: Clock;
  want: Expect;
}

// Fixed clock: Friday 2026-09-18 09:12 Europe/Berlin.
const cases: Case[] = [
  {
    name: 'plain title',
    text: 'Read paper X',
    want: { title: 'Read paper X', tokens: 0, warnings: [] },
  },
  {
    name: 'trims and collapses whitespace',
    text: '  Read   paper   X  ',
    want: { title: 'Read paper X' },
  },
  {
    name: '!today',
    text: 'Read paper X !today',
    want: { title: 'Read paper X', scheduledFor: '2026-09-18' },
  },
  {
    name: '!tmr',
    text: '!tmr Read paper X',
    want: { title: 'Read paper X', scheduledFor: '2026-09-19' },
  },
  { name: '!tomorrow', text: 'Read paper X !tomorrow', want: { scheduledFor: '2026-09-19' } },
  {
    name: '!mon = next Monday',
    text: 'Lecture A !mon',
    want: { title: 'Lecture A', scheduledFor: '2026-09-21' },
  },
  {
    name: '!fri on a Friday = today',
    text: 'Lecture A !fri',
    want: { scheduledFor: '2026-09-18' },
  },
  { name: '!thu = next week Thursday', text: 'x !thu', want: { scheduledFor: '2026-09-24' } },
  { name: '!sun', text: 'x !sun', want: { scheduledFor: '2026-09-20' } },
  {
    name: '!mon on a Monday = today',
    text: 'x !mon',
    clock: clockAt('2026-09-21T09:00:00+02:00'),
    want: { scheduledFor: '2026-09-21' },
  },
  {
    name: '!backlog clears the date',
    text: 'x !today !backlog',
    want: { scheduledFor: undefined },
  },
  {
    name: '!! = today + wantsSlot',
    text: '!! call alice',
    want: {
      title: 'call alice',
      scheduledFor: '2026-09-18',
      wantsSlot: true,
      tokenKinds: ['slot'],
    },
  },
  {
    name: '@9 after 09:00 → tomorrow 09:00',
    text: 'call alice @9',
    want: { scheduledFor: '2026-09-19', block: { start: '09:00', minutes: 40 } },
  },
  {
    name: '@9 before 09:00 → today',
    text: 'call alice @9',
    clock: clockAt('2026-09-18T08:30:00+02:00'),
    want: { scheduledFor: '2026-09-18', block: { start: '09:00', minutes: 40 } },
  },
  {
    name: '@9 at exactly 09:00 → tomorrow',
    text: 'call alice @9',
    clock: clockAt('2026-09-18T09:00:00+02:00'),
    want: { scheduledFor: '2026-09-19' },
  },
  {
    name: '@9:30 (later today)',
    text: 'x @9:30',
    want: { scheduledFor: '2026-09-18', block: { start: '09:30', minutes: 40 } },
  },
  {
    name: '@14 with estimate → padded minutes',
    text: 'x @14 ~1h',
    want: { scheduledFor: '2026-09-18', block: { start: '14:00', minutes: 80 }, estimateMin: 60 },
  },
  {
    name: '@tue 14:00',
    text: 'x @tue 14:00',
    want: { scheduledFor: '2026-09-22', block: { start: '14:00', minutes: 40 }, title: 'x' },
  },
  {
    name: '@tomorrow 9',
    text: 'x @tomorrow 9',
    want: { scheduledFor: '2026-09-19', block: { start: '09:00', minutes: 40 } },
  },
  {
    name: '@mon without time → scheduledFor only',
    text: 'x @mon',
    want: { scheduledFor: '2026-09-21', block: undefined, tokenKinds: ['schedule'] },
  },
  {
    name: '@2026-09-30 10:30',
    text: 'x @2026-09-30 10:30',
    want: { scheduledFor: '2026-09-30', block: { start: '10:30', minutes: 40 } },
  },
  { name: '@ with a chrono date word', text: 'x @sep-30', want: { scheduledFor: '2026-09-30' } },
  {
    name: '!tmr wins over @ date',
    text: 'x @9 !tmr',
    want: { scheduledFor: '2026-09-19', block: { start: '09:00', minutes: 40 } },
  },
  { name: '@alice is not a token', text: 'ask @alice', want: { title: 'ask @alice', tokens: 0 } },
  { name: '~30m', text: 'x ~30m', want: { estimateMin: 30 } },
  { name: '~1h', text: 'x ~1h', want: { estimateMin: 60 } },
  { name: '~1h30', text: 'x ~1h30', want: { estimateMin: 90 } },
  { name: '~1.5h', text: 'x ~1.5h', want: { estimateMin: 90 } },
  { name: '~90', text: 'x ~90', want: { estimateMin: 90, warnings: [] } },
  {
    name: '~120 warns split',
    text: 'x ~120',
    want: { estimateMin: 120, warnings: ['estimate over 90 min — split?'] },
  },
  { name: '~abc is title', text: 'x ~abc', want: { title: 'x ~abc', estimateMin: undefined } },
  { name: '#thesis → project', text: 'x #thesis', want: { project: 'thesis', tags: [] } },
  {
    name: 'second # → tag',
    text: 'x #thesis #reading',
    want: { project: 'thesis', tags: ['reading'] },
  },
  { name: '+tag', text: 'x +urgent +mail', want: { tags: ['urgent', 'mail'] } },
  {
    name: 'when … cue to end',
    text: 'write intro when I sit down at the library',
    want: { title: 'write intro', cue: 'I sit down at the library' },
  },
  {
    name: 'when … stops at next token',
    text: 'write intro when at the library !tmr ~1h',
    want: {
      title: 'write intro',
      cue: 'at the library',
      scheduledFor: '2026-09-19',
      estimateMin: 60,
    },
  },
  {
    name: 'if … then …',
    text: 'if I sit down then write intro',
    want: { title: 'write intro', cue: 'I sit down' },
  },
  {
    name: 'if … then … with tokens after',
    text: 'if coffee is brewing then read paper X #thesis',
    want: { title: 'read paper X', cue: 'coffee is brewing', project: 'thesis' },
  },
  {
    name: 'if without then acts like when',
    text: 'read paper X if bored',
    want: { title: 'read paper X', cue: 'bored' },
  },
  {
    name: 'every day',
    text: 'Water the fern every day',
    want: { title: 'Water the fern', repeat: 'daily' },
  },
  { name: 'every weekday', text: 'gym every weekday', want: { repeat: 'weekdays' } },
  { name: 'every mon', text: 'review every mon', want: { repeat: 'weekly:mon' } },
  { name: 'every sunday', text: 'review every sunday', want: { repeat: 'weekly:sun' } },
  {
    name: 'every without a rule is title',
    text: 'every apple counts',
    want: { title: 'every apple counts', repeat: undefined },
  },
  {
    name: 'due fri (today is Friday)',
    text: 'pay due fri',
    want: { title: 'pay', due: '2026-09-18' },
  },
  { name: 'due 2026-09-30', text: 'pay due 2026-09-30', want: { due: '2026-09-30' } },
  { name: 'due tomorrow', text: 'pay due tomorrow', want: { due: '2026-09-19' } },
  { name: 'due mon', text: 'pay due mon', want: { due: '2026-09-21' } },
  {
    name: 'due without a date is title',
    text: 'due diligence',
    want: { title: 'due diligence', due: undefined },
  },
  {
    name: 'quoted text is literal',
    text: '"!today is not a token" x',
    want: { title: '!today is not a token x', tokens: 0, scheduledFor: undefined },
  },
  {
    name: 'quoted words inside tokens',
    text: 'x "@9 #thesis" !tmr',
    want: {
      title: 'x @9 #thesis',
      scheduledFor: '2026-09-19',
      block: undefined,
      project: undefined,
    },
  },
  {
    name: 'leading ? is a filter',
    text: '?paper',
    want: { title: '', filter: 'paper', tokenKinds: ['filter'], warnings: [] },
  },
  {
    name: 'leading ? with space',
    text: '? thesis reading',
    want: { title: '', filter: 'thesis reading' },
  },
  { name: 'empty text warns no title', text: '   ', want: { title: '', warnings: ['no title'] } },
  {
    name: 'tokens only warn no title',
    text: '!today ~30m #thesis',
    want: { title: '', warnings: ['no title'], scheduledFor: '2026-09-18' },
  },
  {
    name: 'bare ! or @ or # stay in the title',
    text: 'a ! b @ c # d',
    want: { title: 'a ! b @ c # d', tokens: 0 },
  },
  {
    name: 'all tokens together',
    text: 'Read paper X @tue 14:00 ~1h #thesis +urgent due fri when at the library',
    want: {
      title: 'Read paper X',
      scheduledFor: '2026-09-22',
      block: { start: '14:00', minutes: 80 },
      estimateMin: 60,
      project: 'thesis',
      tags: ['urgent'],
      due: '2026-09-18',
      cue: 'at the library',
      tokens: 6,
    },
  },
  {
    name: 'DST day 2026-10-25: @9 before 09:00 is today',
    text: 'x @9',
    clock: clockAt('2026-10-25T02:30:00+02:00'),
    want: { scheduledFor: '2026-10-25', block: { start: '09:00', minutes: 40 } },
  },
  {
    name: 'DST day 2026-10-25: !tmr is the 26th and @tomorrow 9 too',
    text: 'x !tmr @tomorrow 9',
    clock: clockAt('2026-10-25T02:30:00+01:00'),
    want: { scheduledFor: '2026-10-26', block: { start: '09:00', minutes: 40 } },
  },
  {
    name: 'DST day 2026-10-25 late evening: @9 → 26th',
    text: 'x @9',
    clock: clockAt('2026-10-25T20:00:00+01:00'),
    want: { scheduledFor: '2026-10-26' },
  },
  {
    name: 'UTC instant near midnight resolves the Berlin date',
    text: 'x !today',
    clock: clockAt('2026-09-18T22:30:00Z'),
    want: { scheduledFor: '2026-09-19' },
  },
];

describe('parseCapture', () => {
  it.each(cases)('[F-002] $name', ({ text, clock: c, want }) => {
    const out = parseCapture(text, c ?? clock, settings);
    const { tokens, tokenKinds, warnings, ...fields } = want;
    for (const [key, value] of Object.entries(fields)) {
      expect(out[key as keyof ParsedCapture], key).toEqual(value);
    }
    if (tokens !== undefined) expect(out.tokens).toHaveLength(tokens);
    if (tokenKinds !== undefined) expect(out.tokens.map((t) => t.kind)).toEqual(tokenKinds);
    if (warnings !== undefined) expect(out.warnings).toEqual(warnings);
  });

  it('[F-002] lists every parsed token with raw and value for the chip preview', () => {
    const out = parseCapture(
      'Read paper X @tue 14:00 ~30m #thesis +mail every mon due fri when at desk',
      clock,
      settings,
    );
    expect(out.tokens).toEqual([
      { kind: 'block', raw: '@tue 14:00', value: '14:00' },
      { kind: 'estimate', raw: '~30m', value: '30' },
      { kind: 'project', raw: '#thesis', value: 'thesis' },
      { kind: 'tag', raw: '+mail', value: 'mail' },
      { kind: 'repeat', raw: 'every mon', value: 'weekly:mon' },
      { kind: 'due', raw: 'due fri', value: '2026-09-18' },
      { kind: 'cue', raw: 'when at desk', value: 'at desk' },
    ]);
  });

  it('[F-002] never mutates or depends on the clock beyond now() and tz', () => {
    let calls = 0;
    const counting: Clock = {
      now: () => (calls++, new Date('2026-09-18T09:12:00+02:00')),
      tz: 'Europe/Berlin',
    };
    parseCapture('x @tue 14:00 !mon', counting, settings);
    expect(calls).toBeGreaterThan(0);
  });

  it('[F-006] block minutes use the padded estimate (default 30 → 40)', () => {
    expect(parseCapture('x @18', clock, settings).block).toEqual({ start: '18:00', minutes: 40 });
    expect(parseCapture('x @18 ~10m', clock, settings).block).toEqual({
      start: '18:00',
      minutes: 15,
    });
  });
});
