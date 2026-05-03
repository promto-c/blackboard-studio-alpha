import { useCallback, useRef } from 'react';

const EXIT_DURATION_MS = 150;

export function useTreeRowExitAnimation(
  rowRefs: React.RefObject<Map<string, HTMLDivElement>>,
): (keys: string[], onComplete: () => void) => void {
  const pendingRef = useRef(false);

  return useCallback(
    (keys: string[], onComplete: () => void) => {
      if (pendingRef.current) {
        onComplete();
        return;
      }

      const refMap = rowRefs.current;
      const elements: HTMLDivElement[] = [];
      if (refMap) {
        for (const key of keys) {
          const el = refMap.get(key);
          if (el) elements.push(el);
        }
      }

      if (elements.length === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        onComplete();
        return;
      }

      pendingRef.current = true;

      for (const el of elements) {
        el.style.animation = `treeItemExit ${EXIT_DURATION_MS}ms ease-in forwards`;
        el.style.pointerEvents = 'none';
      }

      setTimeout(() => {
        pendingRef.current = false;
        onComplete();
      }, EXIT_DURATION_MS);
    },
    [rowRefs],
  );
}
