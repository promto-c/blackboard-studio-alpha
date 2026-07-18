import { useCallback, useEffect, useRef, useState } from 'react';
import type { NormalizedRect, SceneNode, ViewportWorkingArea } from '@blackboard/types';
import { clampNormalizedRect, normalizedRectFromScenePoints } from './workingArea';

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type DragMode = 'create' | 'move' | ResizeHandle;

interface DragSession {
  mode: DragMode;
  startPoint: { x: number; y: number };
  startRect: NormalizedRect;
}

const scenePointToNormalized = (
  point: { x: number; y: number },
  scene: Pick<SceneNode, 'width' | 'height'>,
) => ({
  x: (point.x + scene.width / 2) / Math.max(1, scene.width),
  y: (point.y + scene.height / 2) / Math.max(1, scene.height),
});

const hitTest = (
  point: { x: number; y: number },
  rect: NormalizedRect,
  threshold: { x: number; y: number },
): DragMode => {
  const left = rect.x;
  const top = rect.y;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const nearLeft = Math.abs(point.x - left) <= threshold.x;
  const nearRight = Math.abs(point.x - right) <= threshold.x;
  const nearTop = Math.abs(point.y - top) <= threshold.y;
  const nearBottom = Math.abs(point.y - bottom) <= threshold.y;
  const insideX = point.x >= left - threshold.x && point.x <= right + threshold.x;
  const insideY = point.y >= top - threshold.y && point.y <= bottom + threshold.y;

  if (nearLeft && nearTop) return 'nw';
  if (nearRight && nearTop) return 'ne';
  if (nearRight && nearBottom) return 'se';
  if (nearLeft && nearBottom) return 'sw';
  if (nearTop && insideX) return 'n';
  if (nearRight && insideY) return 'e';
  if (nearBottom && insideX) return 's';
  if (nearLeft && insideY) return 'w';
  if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) return 'move';
  return 'create';
};

const resizeRect = (
  start: NormalizedRect,
  mode: ResizeHandle,
  delta: { x: number; y: number },
): NormalizedRect => {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (mode.includes('w')) left += delta.x;
  if (mode.includes('e')) right += delta.x;
  if (mode.includes('n')) top += delta.y;
  if (mode.includes('s')) bottom += delta.y;
  if (left > right) [left, right] = [right, left];
  if (top > bottom) [top, bottom] = [bottom, top];
  return clampNormalizedRect({ x: left, y: top, width: right - left, height: bottom - top });
};

export function useWorkingAreaInteraction({
  active,
  scene,
  zoom,
  workingArea,
  onCommit,
}: {
  active: boolean;
  scene: Pick<SceneNode, 'width' | 'height'> | undefined;
  zoom: number;
  workingArea: ViewportWorkingArea;
  onCommit: (rect: NormalizedRect) => void;
}) {
  const [draftRect, setDraftRect] = useState<NormalizedRect | null>(null);
  const draftRectRef = useRef<NormalizedRect | null>(null);
  const sessionRef = useRef<DragSession | null>(null);

  const updateDraftRect = useCallback((rect: NormalizedRect | null) => {
    draftRectRef.current = rect;
    setDraftRect(rect);
  }, []);

  useEffect(() => {
    if (!active) {
      sessionRef.current = null;
      updateDraftRect(null);
    }
  }, [active, updateDraftRect]);

  const handleMouseDown = useCallback(
    (point: { x: number; y: number }, button: number): boolean => {
      if (!active || !scene || button !== 0) return false;
      const normalizedPoint = scenePointToNormalized(point, scene);
      if (
        normalizedPoint.x < 0 ||
        normalizedPoint.x > 1 ||
        normalizedPoint.y < 0 ||
        normalizedPoint.y > 1
      ) {
        return false;
      }
      const thresholdPixels = Math.max(5, 9 / Math.max(zoom, 0.01));
      const mode = workingArea.enabled
        ? hitTest(normalizedPoint, workingArea.rect, {
            x: thresholdPixels / scene.width,
            y: thresholdPixels / scene.height,
          })
        : 'create';
      const startRect = workingArea.enabled
        ? workingArea.rect
        : { x: normalizedPoint.x, y: normalizedPoint.y, width: 0.001, height: 0.001 };
      sessionRef.current = { mode, startPoint: point, startRect };
      updateDraftRect(startRect);
      return true;
    },
    [active, scene, updateDraftRect, workingArea.enabled, workingArea.rect, zoom],
  );

  const handleMouseMove = useCallback(
    (point: { x: number; y: number }, modifiers: { alt: boolean; shift: boolean }): boolean => {
      const session = sessionRef.current;
      if (!session || !scene) return false;
      const delta = {
        x: (point.x - session.startPoint.x) / scene.width,
        y: (point.y - session.startPoint.y) / scene.height,
      };

      if (session.mode === 'move') {
        const maxX = 1 - session.startRect.width;
        const maxY = 1 - session.startRect.height;
        updateDraftRect({
          ...session.startRect,
          x: Math.max(0, Math.min(maxX, session.startRect.x + delta.x)),
          y: Math.max(0, Math.min(maxY, session.startRect.y + delta.y)),
        });
        return true;
      }

      if (session.mode !== 'create') {
        updateDraftRect(resizeRect(session.startRect, session.mode, delta));
        return true;
      }

      let endPoint = point;
      let startPoint = session.startPoint;
      if (modifiers.shift) {
        const dx = point.x - session.startPoint.x;
        const dy = point.y - session.startPoint.y;
        const extent = Math.max(Math.abs(dx), Math.abs(dy));
        endPoint = {
          x: session.startPoint.x + Math.sign(dx || 1) * extent,
          y: session.startPoint.y + Math.sign(dy || 1) * extent,
        };
      }
      if (modifiers.alt) {
        startPoint = {
          x: session.startPoint.x - (endPoint.x - session.startPoint.x),
          y: session.startPoint.y - (endPoint.y - session.startPoint.y),
        };
      }
      updateDraftRect(normalizedRectFromScenePoints(startPoint, endPoint, scene));
      return true;
    },
    [scene, updateDraftRect],
  );

  const handleMouseUp = useCallback((): boolean => {
    if (!sessionRef.current) return false;
    sessionRef.current = null;
    const draft = draftRectRef.current;
    updateDraftRect(null);
    if (draft) onCommit(draft);
    return true;
  }, [onCommit, updateDraftRect]);

  return {
    draftRect,
    isDragging: sessionRef.current !== null,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
}
