/**
 * Module-level debug event bus.
 *
 * Allows plain module functions (e.g. AI request helpers) to publish debug events
 * without depending on React hooks. The DebugLogProvider subscribes to this bus
 * and forwards events into React state.
 */

export interface DebugBusEvent {
  id: string;
  timestamp: number;
  type:
    | 'tool_call'
    | 'tool_result'
    | 'info'
    | 'error'
    | 'stream'
    | 'agent_step'
    | 'network'
    | 'ai_request'
    | 'ai_response';
  source: string;
  detail: string;
  /** Arbitrary JSON-serializable data (payloads, etc.) */
  data?: Record<string, unknown>;
}

type DebugBusListener = (event: DebugBusEvent) => void;

let listeners: DebugBusListener[] = [];
let idCounter = 0;

export function publishDebugEvent(event: Omit<DebugBusEvent, 'id' | 'timestamp'>): void {
  const entry: DebugBusEvent = {
    ...event,
    id: `debug_evt_${++idCounter}_${Date.now().toString(36)}`,
    timestamp: Date.now(),
  };
  for (const listener of listeners) {
    try {
      listener(entry);
    } catch {
      // Swallow listener errors to avoid breaking the caller
    }
  }
}

export function subscribeToDebugBus(listener: DebugBusListener): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

/** Clear all subscribers (for testing / cleanup) */
export function clearDebugBusSubscribers(): void {
  listeners = [];
}
