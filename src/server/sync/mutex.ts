/**
 * The single sync mutex: one p-queue with concurrency 1. Every git operation and every host
 * call runs inside it, and queued cycles coalesce (a cycle requested while one is already
 * waiting joins that one instead of adding another).
 */
import PQueue from 'p-queue';

export interface CycleQueue<T> {
  /** Enqueue a run; if one is already queued (not yet started), return its promise instead. */
  enqueue(force: boolean): Promise<T>;
  /** Resolves when nothing is running or queued. */
  onIdle(): Promise<void>;
  readonly size: number;
  readonly pending: number;
}

export function createCycleQueue<T>(run: (force: boolean) => Promise<T>): CycleQueue<T> {
  const queue = new PQueue({ concurrency: 1 });
  let waiting: { promise: Promise<T>; force: boolean } | null = null;

  return {
    enqueue(force) {
      if (waiting) {
        // A forced request upgrades the queued cycle so it bypasses the offline backoff.
        if (force) waiting.force = true;
        return waiting.promise;
      }
      const entry = { promise: Promise.resolve() as unknown as Promise<T>, force };
      waiting = entry;
      entry.promise = queue.add(async () => {
        if (waiting === entry) waiting = null;
        return run(entry.force);
      }) as Promise<T>;
      return entry.promise;
    },
    onIdle: () => queue.onIdle(),
    get size() {
      return queue.size;
    },
    get pending() {
      return queue.pending;
    },
  };
}
