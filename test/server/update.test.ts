import { describe, expect, it } from 'vitest';
import { silentLogger } from '../../src/server/log';
import { IDLE_MS, startUpdateChecker } from '../../src/server/update';

const RUNNING = 'a'.repeat(40);
const NEWER = 'b'.repeat(40);

function harness(over: {
  remote?: string | null;
  lastMutation?: number | null;
  enabled?: boolean;
}) {
  const exits: number[] = [];
  const events: Array<{ sha: string }> = [];
  const checker = startUpdateChecker({
    gitSha: RUNNING,
    enabled: over.enabled ?? true,
    cwd: '.',
    lastMutationAt: () => over.lastMutation ?? null,
    broadcast: (_e, payload) => events.push(payload),
    log: silentLogger,
    exit: (code) => exits.push(code),
    lsRemote: async () => over.remote ?? null,
    now: () => 1_000_000,
    intervalMs: 60 * 60 * 1000,
  });
  return { checker, exits, events };
}

describe('update checker', () => {
  it('[F-024] exits 75 when stable moved and the user has been idle for 2 minutes', async () => {
    const h = harness({ remote: NEWER, lastMutation: 1_000_000 - IDLE_MS - 1 });
    await h.checker.checkNow();
    expect(h.exits).toEqual([75]);
    expect(h.events).toEqual([]);
    h.checker.stop();
  });

  it('[F-024] announces the update once over SSE while the user is active', async () => {
    const h = harness({ remote: NEWER, lastMutation: 1_000_000 - 1000 });
    await h.checker.checkNow();
    await h.checker.checkNow();
    expect(h.exits).toEqual([]);
    expect(h.events).toEqual([{ sha: NEWER }]);
    h.checker.stop();
  });

  it('[F-024] stays silent when stable is unchanged, unreachable, or sync is off', async () => {
    for (const over of [{ remote: RUNNING }, { remote: null }, { remote: NEWER, enabled: false }]) {
      const h = harness(over);
      await h.checker.checkNow();
      expect(h.exits).toEqual([]);
      expect(h.events).toEqual([]);
      h.checker.stop();
    }
  });
});
