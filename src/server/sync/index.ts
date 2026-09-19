// STUB — replaced by the real implementation (owner: sync module). Keeps the server bootable without git.
import type { Sync, SyncHost, SyncOptions, SyncStatus } from './types';

export function createSync(_host: SyncHost, _opts: SyncOptions = {}): Sync {
  const status: SyncStatus = {
    enabled: false,
    lastSync: null,
    lastPush: null,
    remoteSha: null,
    pending: 0,
    offline: false,
    conflict: null,
    hermesLastSeen: null,
    rejectedCount: 0,
    lastError: null,
    cycles: 0,
  };
  return {
    start() {},
    async stop() {},
    notifyLocalChange() {},
    async forceCycle() {
      return status;
    },
    status: () => status,
  };
}

export type { Sync, SyncHost, SyncOptions, SyncStatus } from './types';
