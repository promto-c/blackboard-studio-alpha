import type { PaintLivePreview } from './paintModel';

let activePreview: PaintLivePreview | null = null;

export const setPaintLivePreview = (preview: PaintLivePreview | null): void => {
  activePreview = preview;
};

export const getPaintLivePreview = (nodeId: string): PaintLivePreview | null =>
  activePreview?.nodeId === nodeId ? activePreview : null;

export const clearPaintLivePreview = (nodeId?: string): void => {
  if (!nodeId || activePreview?.nodeId === nodeId) activePreview = null;
};
