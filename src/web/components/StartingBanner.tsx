import { useEffect } from 'react';
import { api } from '../api';
import { sourceClosed, useStore } from '../store';
import { T } from '../testids';

export const HEALTH_POLL_MS = 2000;

/** Shown while the SSE stream is disconnected; polls /api/health every 2 s and reconnects. */
export function StartingBanner() {
  const connected = useStore((s) => s.connected);
  const connect = useStore((s) => s.connect);
  useEffect(() => {
    if (connected) return;
    let stopped = false;
    const poll = async () => {
      try {
        const h = await api.health();
        if (!stopped && h.ok && sourceClosed()) connect();
      } catch {
        // still starting
      }
    };
    const id = setInterval(() => void poll(), HEALTH_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [connected, connect]);
  if (connected) return null;
  return (
    <div className="starting" data-testid={T.startingBanner} role="status">
      Quickdo server is starting… retrying
    </div>
  );
}
