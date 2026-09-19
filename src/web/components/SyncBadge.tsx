import type { SyncStatus } from '../../server/sync/types';
import { hhmmOfInstant } from '../format';
import { useStore } from '../store';
import { T } from '../testids';

export function syncLabel(sync: SyncStatus): { text: string; tone: '' | 'amber' | 'danger' } {
  if (!sync.enabled) return { text: 'sync off', tone: '' };
  if (sync.conflict) return { text: `conflict ${hhmmOfInstant(sync.conflict.at)}`, tone: 'danger' };
  if (sync.offline)
    return { text: `offline${sync.pending ? ` · ${sync.pending} pending` : ''}`, tone: 'amber' };
  if (sync.pending > 0) return { text: `pending ${sync.pending}`, tone: 'amber' };
  if (sync.lastSync) return { text: `synced ${hhmmOfInstant(sync.lastSync)}`, tone: '' };
  return { text: 'not synced yet', tone: '' };
}

/** Sync status from `state.sync`; click or `g s` forces a cycle (F-022). */
export function SyncBadge() {
  const sync = useStore((s) => s.state?.sync);
  const forceSync = useStore((s) => s.forceSync);
  if (!sync) return null;
  const { text, tone } = syncLabel(sync);
  return (
    <>
      <button
        type="button"
        className={`badge ${tone}`}
        data-testid={T.syncBadge}
        data-tone={tone || 'ok'}
        title={sync.lastError ? `last error: ${sync.lastError}` : 'g s = sync now'}
        onClick={() => void forceSync()}
      >
        {text}
      </button>
      {sync.hermesLastSeen && (
        <span className="badge" title="last ingested agent command">
          hermes {hhmmOfInstant(sync.hermesLastSeen)}
        </span>
      )}
      {sync.rejectedCount > 0 && (
        <span className="badge amber" title="files in inbox/rejected">
          {sync.rejectedCount} rejected
        </span>
      )}
    </>
  );
}
