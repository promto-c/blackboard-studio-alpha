import type { ViewportInteraction } from '@/nodes/NodeDefinition';

/** No-op interaction returned when no interaction is set up for the selected node. */
export const noopViewportInteraction: ViewportInteraction = {
  getCursor: () => null,
  hasGlobalMouseCapture: () => false,
  handleMouseDown: () => false,
  handleMouseMove: () => false,
  handleMouseUp: () => false,
  handleMouseLeave: () => {},
  cleanupOnToolChange: () => {},
  shouldForceOverlays: () => false,
  handleCommand: () => false,
};
