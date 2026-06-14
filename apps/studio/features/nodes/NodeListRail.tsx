import React, { useState, useCallback, useLayoutEffect } from 'react';
import type { AnyNode } from '@blackboard/types';

interface RailSegment {
  top: number;
  height: number;
}

const PIPELINE_RAIL_CLASS = 'right-4';

function RailSegmentView({
  segment,
  showEndpoint = true,
}: {
  segment: RailSegment;
  showEndpoint?: boolean;
}) {
  return (
    <>
      <div
        className="absolute left-0 w-px rounded-full bg-gray-400/30"
        style={{ top: segment.top, height: segment.height }}
      />
      {showEndpoint ? (
        <div
          className="absolute left-0 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-gray-400/40 bg-gray-900"
          style={{ top: segment.top + segment.height }}
        />
      ) : null}
    </>
  );
}

export function PipelineRail({
  listRef,
  itemRefs,
  stacks,
  passThroughStacks,
  layoutVersion,
}: {
  listRef: React.RefObject<HTMLDivElement | null>;
  itemRefs: React.RefObject<Map<string, HTMLDivElement>>;
  stacks: AnyNode[][];
  passThroughStacks: AnyNode[][];
  layoutVersion: number;
}) {
  const [segments, setSegments] = useState<RailSegment[]>([]);
  const [passThroughSegments, setPassThroughSegments] = useState<RailSegment[]>([]);

  const updateSegments = useCallback(() => {
    if (!listRef.current) {
      setSegments([]);
      setPassThroughSegments([]);
      return;
    }

    const listRect = listRef.current.getBoundingClientRect();
    const getRowRects = (rows: AnyNode[][]) =>
      rows
        .map((stack) => itemRefs.current.get(stack[0].id))
        .filter((el): el is HTMLDivElement => !!el)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            top: rect.top - listRect.top,
            bottom: rect.bottom - listRect.top,
          };
        })
        .sort((a, b) => a.top - b.top);
    const rowRects = getRowRects(stacks);
    const nextPassThroughSegments = getRowRects(passThroughStacks)
      .map((rect) => ({
        top: rect.top,
        height: rect.bottom - rect.top,
      }))
      .filter((segment) => segment.height > 0);

    setPassThroughSegments(nextPassThroughSegments);

    if (rowRects.length < 2) {
      setSegments([]);
      return;
    }

    setSegments(
      rowRects
        .slice(0, -1)
        .map((rect, index) => {
          const nextRect = rowRects[index + 1];
          return {
            top: rect.bottom,
            height: nextRect.top - rect.bottom,
          };
        })
        .filter((segment) => segment.height > 0),
    );
  }, [itemRefs, listRef, passThroughStacks, stacks]);

  useLayoutEffect(() => {
    updateSegments();

    const animationFrameId = window.requestAnimationFrame(updateSegments);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [layoutVersion, updateSegments]);

  if (segments.length === 0 && passThroughSegments.length === 0) return null;

  return (
    <div
      className={`pointer-events-none absolute top-0 bottom-0 ${PIPELINE_RAIL_CLASS}`}
      aria-hidden="true"
    >
      {passThroughSegments.map((segment, index) => (
        <RailSegmentView key={`pass-through-${segment.top}-${index}`} segment={segment} />
      ))}
      {segments.map((segment, index) => (
        <RailSegmentView key={`${segment.top}-${index}`} segment={segment} />
      ))}
    </div>
  );
}
