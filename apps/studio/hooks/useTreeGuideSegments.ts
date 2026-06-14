import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  collectTreeGuideSegments,
  type TreeGuideAdapter,
  type TreeGuideRowMetric,
  type TreeGuideSegment,
} from '@/utils/treeGuides';

type RefValue<T> = {
  current: T;
};

interface UseTreeGuideSegmentsOptions<TItem> {
  items: readonly TItem[];
  flatRowKeys: readonly string[];
  rowRefs: RefValue<Map<string, HTMLDivElement>>;
  contentRef: RefValue<HTMLDivElement | null>;
  viewportRef?: RefValue<HTMLDivElement | null>;
  adapter: TreeGuideAdapter<TItem>;
}

export const useTreeGuideSegments = <TItem>({
  items,
  flatRowKeys,
  rowRefs,
  contentRef,
  viewportRef,
  adapter,
}: UseTreeGuideSegmentsOptions<TItem>): TreeGuideSegment[] => {
  const [segments, setSegments] = useState<TreeGuideSegment[]>([]);

  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const flatRowKeysRef = useRef(flatRowKeys);
  flatRowKeysRef.current = flatRowKeys;

  const updateTreeGuides = useCallback(() => {
    const contentElement = contentRef.current;
    if (!contentElement || flatRowKeysRef.current.length === 0) {
      setSegments([]);
      return;
    }

    const contentRect = contentElement.getBoundingClientRect();
    const rowMetrics = new Map<string, TreeGuideRowMetric>();

    flatRowKeysRef.current.forEach((rowKey) => {
      const element = rowRefs.current.get(rowKey);
      if (!element) return;

      const rect = element.getBoundingClientRect();
      rowMetrics.set(rowKey, {
        height: rect.height,
        top: rect.top - contentRect.top,
      });
    });

    setSegments(collectTreeGuideSegments(itemsRef.current, rowMetrics, adapterRef.current));
  }, [contentRef, rowRefs]);

  useLayoutEffect(() => {
    updateTreeGuides();
  }, [updateTreeGuides]);

  useEffect(() => {
    const contentElement = contentRef.current;
    const viewportElement = viewportRef?.current ?? null;
    if ((!contentElement && rowRefs.current.size === 0) || typeof ResizeObserver === 'undefined') {
      return;
    }

    let frameId = 0;
    const scheduleGuideUpdate = () => {
      if (frameId !== 0) {
        cancelAnimationFrame(frameId);
      }

      frameId = requestAnimationFrame(() => {
        frameId = 0;
        updateTreeGuides();
      });
    };

    scheduleGuideUpdate();

    const observer = new ResizeObserver(() => {
      scheduleGuideUpdate();
    });

    if (contentElement) {
      observer.observe(contentElement);
    }

    if (viewportElement) {
      observer.observe(viewportElement);
    }

    rowRefs.current.forEach((element) => {
      observer.observe(element);
    });

    return () => {
      if (frameId !== 0) {
        cancelAnimationFrame(frameId);
      }
      observer.disconnect();
    };
  }, [contentRef, flatRowKeys, rowRefs, updateTreeGuides, viewportRef]);

  return segments;
};
