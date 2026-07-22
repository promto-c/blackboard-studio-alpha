import type { CSSProperties } from 'react';

export type ViewportInterpolation = 'nearest' | 'linear';

export const getViewportImageRendering = (
  interpolation: ViewportInterpolation,
): CSSProperties['imageRendering'] => (interpolation === 'nearest' ? 'pixelated' : 'auto');
