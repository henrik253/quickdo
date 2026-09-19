/**
 * Fan-out of server-sent events to every connected SSE client (GET /api/events).
 */
export type SseEventName = 'state' | 'sync' | 'agent' | 'update' | 'reminder';

export interface SseMessage {
  event: SseEventName;
  data: string; // JSON
}

export type Subscriber = (msg: SseMessage) => void;

export interface Broadcaster {
  subscribe(fn: Subscriber): () => void;
  broadcast(event: SseEventName, payload: unknown): void;
  size(): number;
}

export function createBroadcaster(): Broadcaster {
  const subs = new Set<Subscriber>();
  return {
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    broadcast(event, payload) {
      const msg: SseMessage = { event, data: JSON.stringify(payload ?? null) };
      for (const fn of subs) {
        try {
          fn(msg);
        } catch {
          // a dead subscriber must never break the others
        }
      }
    },
    size: () => subs.size,
  };
}
