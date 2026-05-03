import { useCallback, useEffect, useRef } from 'react';

interface UseFrameScrubSessionParams {
  setFrameScrubbing: (isScrubbing: boolean) => void;
}

/**
 * Shares the same interactive frame-scrub lifecycle across viewport and
 * timeline drags so expensive follow-up work can wait until the drag finishes.
 */
export function useFrameScrubSession({ setFrameScrubbing }: UseFrameScrubSessionParams): {
  startFrameScrubSession: (onMove: (event: MouseEvent) => void, onEnd?: () => void) => void;
} {
  const cleanupRef = useRef<(() => void) | null>(null);
  const isSessionActiveRef = useRef(false);

  const clearSession = useCallback(() => {
    const cleanup = cleanupRef.current;
    cleanupRef.current = null;
    cleanup?.();
    if (isSessionActiveRef.current) {
      isSessionActiveRef.current = false;
      setFrameScrubbing(false);
    }
  }, [setFrameScrubbing]);

  const startFrameScrubSession = useCallback(
    (onMove: (event: MouseEvent) => void, onEnd?: () => void) => {
      clearSession();
      isSessionActiveRef.current = true;
      setFrameScrubbing(true);

      const handleMouseMove = (event: MouseEvent) => {
        onMove(event);
      };

      const handleMouseUp = () => {
        clearSession();
        onEnd?.();
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);

      cleanupRef.current = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    },
    [clearSession, setFrameScrubbing],
  );

  useEffect(() => clearSession, [clearSession]);

  return { startFrameScrubSession };
}
