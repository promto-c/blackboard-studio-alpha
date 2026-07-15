import type { ViewportInteraction, ViewportPointerEvent } from '@/nodes/NodeDefinition';
import type { ViewportAdapterContext } from '../viewportAdapterContext';

export class BaseViewportInteraction implements ViewportInteraction {
  /**
   * Shared no-op instance used as a fallback interaction when no node is
   * selected or a node type doesn't provide createViewportInteraction.
   */
  static readonly NOOP: ViewportInteraction = new BaseViewportInteraction(
    null as unknown as ViewportAdapterContext,
  );

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
