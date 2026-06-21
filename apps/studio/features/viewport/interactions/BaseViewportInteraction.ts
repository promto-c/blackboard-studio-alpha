import type { ViewportInteraction, ViewportPointerEvent } from '@/nodes/NodeDefinition';
import type { ViewportAdapterContext } from '../viewportAdapterContext';

export class BaseViewportInteraction implements ViewportInteraction {
  constructor(protected ctx: ViewportAdapterContext) {}

  getCursor(): string | null {
    return null;
  }

  isPreviewActive(): boolean {
    return false;
  }

  hasGlobalMouseCapture(): boolean {
    return false;
  }

  handleMouseDown(_event: ViewportPointerEvent): boolean {
    return false;
  }

  handleMouseMove(_event: ViewportPointerEvent): boolean {
    return false;
  }

  handleMouseUp(_event: ViewportPointerEvent): boolean {
    return false;
  }

  handleMouseLeave(): void {}

  cleanupOnToolChange(_previousTool: string | null): void {}

  shouldForceOverlays(): boolean {
    return false;
  }

  handleCommand(_commandId: string): boolean {
    return false;
  }
}

export const noopViewportInteraction: ViewportInteraction = {
  getCursor: () => null,
  isPreviewActive: () => false,
  hasGlobalMouseCapture: () => false,
  handleMouseDown: () => false,
  handleMouseMove: () => false,
  handleMouseUp: () => false,
  handleMouseLeave: () => {},
  cleanupOnToolChange: () => {},
  shouldForceOverlays: () => false,
  handleCommand: () => false,
};
