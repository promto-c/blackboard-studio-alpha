import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
} from 'react';

interface UIInteractionCoordinator {
  beginInteraction?: (interactionId: string) => void;
  endInteraction?: (interactionId: string) => void;
}

export interface UIInteractionProviderProps extends UIInteractionCoordinator {
  children: ReactNode;
}

const UIInteractionContext = createContext<UIInteractionCoordinator | null>(null);

/**
 * Connects continuous UI gestures to an application-level interaction system.
 * Consumers such as NumberInput and Slider remain usable without a provider.
 */
export function UIInteractionProvider({
  beginInteraction,
  endInteraction,
  children,
}: UIInteractionProviderProps) {
  const coordinator = useMemo(
    () => ({ beginInteraction, endInteraction }),
    [beginInteraction, endInteraction],
  );

  return (
    <UIInteractionContext.Provider value={coordinator}>{children}</UIInteractionContext.Provider>
  );
}

interface UIInteractionSessionOptions {
  idPrefix: string;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}

/** Internal building block for shared controls with a continuous gesture. */
export function useUIInteractionSession({
  idPrefix,
  onInteractionStart,
  onInteractionEnd,
}: UIInteractionSessionOptions) {
  const coordinator = useContext(UIInteractionContext);
  const instanceId = useId();
  const callbacksRef = useRef({ coordinator, onInteractionStart, onInteractionEnd });
  const activeSessionRef = useRef<{
    id: string;
    endInteraction?: (interactionId: string) => void;
  } | null>(null);
  callbacksRef.current = { coordinator, onInteractionStart, onInteractionEnd };

  const startInteraction = useCallback(() => {
    if (activeSessionRef.current) return;

    const callbacks = callbacksRef.current;
    const id = `${idPrefix}:${instanceId}`;
    callbacks.coordinator?.beginInteraction?.(id);
    activeSessionRef.current = {
      id,
      endInteraction: callbacks.coordinator?.beginInteraction
        ? callbacks.coordinator.endInteraction
        : undefined,
    };
    callbacks.onInteractionStart?.();
  }, [idPrefix, instanceId]);

  const endInteraction = useCallback(() => {
    const session = activeSessionRef.current;
    if (!session) return;

    activeSessionRef.current = null;
    session.endInteraction?.(session.id);
    callbacksRef.current.onInteractionEnd?.();
  }, []);

  useEffect(() => endInteraction, [endInteraction]);

  return { startInteraction, endInteraction };
}
