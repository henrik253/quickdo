import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM without types (bin/ has no build step)
import { parseArgs, resolvePort, toPort } from '../bin/lib/args.mjs';

describe('bin/lib/args.mjs', () => {
  it('[F-003] bare words are a capture, flags are extracted in any position', () => {
    expect(parseArgs(['Read', 'paper', 'X', '--today'])).toEqual({
      command: 'capture',
      text: 'Read paper X',
      today: true,
      port: null,
    });
    expect(parseArgs(['-p', '8000', 'Lecture', 'A'])).toMatchObject({
      command: 'capture',
      text: 'Lecture A',
      port: 8000,
    });
    expect(parseArgs(['--port=9001', 'x'])).toMatchObject({ port: 9001 });
  });

  it('[F-003] a leading known command selects it, and -- ends flag parsing', () => {
    expect(parseArgs(['status'])).toMatchObject({ command: 'status', text: '' });
    expect(parseArgs(['doctor', '--port', '7778'])).toMatchObject({
      command: 'doctor',
      port: 7778,
    });
    expect(parseArgs(['--', 'status', '--today'])).toMatchObject({
      command: 'capture',
      text: 'status --today',
      today: false,
    });
    expect(parseArgs(['--help'])).toMatchObject({ command: 'help' });
  });

  it('[F-003] invalid ports are rejected', () => {
    expect(toPort('0')).toBeNull();
    expect(toPort('70000')).toBeNull();
    expect(toPort('abc')).toBeNull();
    expect(parseArgs(['--port', 'abc', 'x']).error).toMatch(/invalid --port/);
  });

  it('[F-003] port precedence is flag > QUICKDO_PORT > config.json > 7777', () => {
    expect(resolvePort(1234, { QUICKDO_PORT: '2' }, { port: 3 })).toBe(1234);
    expect(resolvePort(null, { QUICKDO_PORT: '2' }, { port: 3 })).toBe(2);
    expect(resolvePort(null, { QUICKDO_PORT: '' }, { port: 3 })).toBe(3);
    expect(resolvePort(null, {}, null)).toBe(7777);
    expect(resolvePort(null, {}, { port: 'x' })).toBe(7777);
  });
});
