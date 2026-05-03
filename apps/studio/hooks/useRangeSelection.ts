import { useCallback, useRef } from 'react';

export const useRangeSelection = () => {
  const anchorKeyRef = useRef<string | null>(null);

  const setAnchor = useCallback((key: string) => {
    anchorKeyRef.current = key;
  }, []);

  const clearAnchor = useCallback(() => {
    anchorKeyRef.current = null;
  }, []);

  /**
   * Given the full ordered list of visible row keys and a target key,
   * returns the inclusive slice of keys between the anchor and target.
   * Returns null if no anchor is set or either key is not found.
   */
  const getRangeKeys = useCallback(
    (targetKey: string, flatKeys: readonly string[]): string[] | null => {
      const anchor = anchorKeyRef.current;
      if (!anchor) return null;

      const anchorIndex = flatKeys.indexOf(anchor);
      const targetIndex = flatKeys.indexOf(targetKey);

      if (anchorIndex === -1 || targetIndex === -1) return null;

      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);

      return flatKeys.slice(start, end + 1);
    },
    [],
  );

  return { setAnchor, clearAnchor, getRangeKeys };
};
