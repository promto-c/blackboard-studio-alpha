import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
  useRef,
  useEffect,
} from 'react';
import { subscribeToDebugBus, type DebugBusEvent } from '@/utils/debugEventBus';

export interface DebugLogEntry {
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
  data?: Record<string, unknown>;
}

const MAX_LOG_ENTRIES = 500;

interface DebugLogContextType {
  entries: DebugLogEntry[];
  addLog: (entry: Omit<DebugLogEntry, 'id' | 'timestamp'>) => void;
  clearLog: () => void;
}

const DebugLogContext = createContext<DebugLogContextType | undefined>(undefined);

export const useDebugLog = (): DebugLogContextType => {
  const context = useContext(DebugLogContext);
  if (!context) {
    // Return a no-op fallback when used outside provider
    return {
      entries: [],
      addLog: () => {},
      clearLog: () => {},
    };
  }
  return context;
};

export function DebugLogProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<DebugLogEntry[]>([]);
  const idCounter = useRef(0);

  const addLog = useCallback((entry: Omit<DebugLogEntry, 'id' | 'timestamp'>) => {
    idCounter.current += 1;
    const newEntry: DebugLogEntry = {
      ...entry,
      id: `debug_${idCounter.current}_${Date.now().toString(36)}`,
      timestamp: Date.now(),
    };
    setEntries((prev) => {
      const next = [...prev, newEntry];
      if (next.length > MAX_LOG_ENTRIES) {
        return next.slice(next.length - MAX_LOG_ENTRIES);
      }
      return next;
    });
  }, []);

  // Subscribe to the module-level debug event bus
  useEffect(() => {
    const unsubscribe = subscribeToDebugBus((event: DebugBusEvent) => {
      idCounter.current += 1;
      const newEntry: DebugLogEntry = {
        id: event.id,
        timestamp: event.timestamp,
        type: event.type,
        source: event.source,
        detail: event.detail,
        data: event.data,
      };
      setEntries((prev) => {
        const next = [...prev, newEntry];
        if (next.length > MAX_LOG_ENTRIES) {
          return next.slice(next.length - MAX_LOG_ENTRIES);
        }
        return next;
      });
    });
    return unsubscribe;
  }, []);

  const clearLog = useCallback(() => {
    setEntries([]);
  }, []);

  return (
    <DebugLogContext.Provider value={{ entries, addLog, clearLog }}>
      {children}
    </DebugLogContext.Provider>
  );
}
