import { useSyncExternalStore } from 'react';
import type { RotoPointType } from '@blackboard/types';
import type { ContourPoint } from '@/utils/contour';
import type { RotoShapeRasterBounds } from '@/utils/rotoShapeRaster';

export const ROTO_PART_PREVIEW_COLORS = [
  [56, 189, 248],
  [244, 114, 182],
  [52, 211, 153],
  [250, 204, 21],
  [167, 139, 250],
  [251, 146, 60],
  [34, 211, 238],
  [248, 113, 113],
] as const;

export interface RotoPartSeparationPreviewPart {
  index: number;
  seed: ContourPoint;
  contour: ContourPoint[];
  pointTypes?: RotoPointType[];
  corePixelCount: number;
  pixelCount: number;
}

export interface RotoPartSeparationPreviewState {
  ownerId: string;
  nodeId: string;
  sourcePathId: string;
  sourceFrame: number;
  width: number;
  height: number;
  sceneBounds: RotoShapeRasterBounds;
  partCount: number;
  overlap: number;
  branchReach: number;
  parts: RotoPartSeparationPreviewPart[];
}

type Listener = () => void;

const previews = new Map<string, RotoPartSeparationPreviewState>();
const listeners = new Map<string, Set<Listener>>();

const emit = (nodeId: string): void => listeners.get(nodeId)?.forEach((listener) => listener());

export const setRotoPartSeparationPreview = (preview: RotoPartSeparationPreviewState): void => {
  previews.set(preview.nodeId, preview);
  emit(preview.nodeId);
};

/** Owner-aware clearing prevents a stale panel cleanup from removing a newer preview. */
export const clearRotoPartSeparationPreview = (nodeId: string, ownerId?: string): void => {
  const current = previews.get(nodeId);
  if (!current || (ownerId && current.ownerId !== ownerId)) return;
  previews.delete(nodeId);
  emit(nodeId);
};

export const getRotoPartSeparationPreview = (
  nodeId: string,
): RotoPartSeparationPreviewState | null => previews.get(nodeId) ?? null;

export const subscribeToRotoPartSeparationPreview = (
  nodeId: string,
  listener: Listener,
): (() => void) => {
  const nodeListeners = listeners.get(nodeId) ?? new Set<Listener>();
  nodeListeners.add(listener);
  listeners.set(nodeId, nodeListeners);
  return () => {
    nodeListeners.delete(listener);
    if (nodeListeners.size === 0) listeners.delete(nodeId);
  };
};

export const useRotoPartSeparationPreview = (
  nodeId: string,
): RotoPartSeparationPreviewState | null =>
  useSyncExternalStore(
    (listener) => subscribeToRotoPartSeparationPreview(nodeId, listener),
    () => getRotoPartSeparationPreview(nodeId),
    () => null,
  );
