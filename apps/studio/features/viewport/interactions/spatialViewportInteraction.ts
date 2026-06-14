import type { ViewportPointerEvent } from '@/nodes/NodeDefinition';
import type { ViewportAdapterContext } from '../viewportAdapterContext';
import { BaseViewportInteraction } from './BaseViewportInteraction';

/**
 * SpatialViewportInteraction — adapts the spatial interaction hook
 * into a ViewportInteraction. The spatial interaction uses
 * handleGlobalMouseMove for window-level drag handling during
 * transform handle manipulation.
 */
export class SpatialViewportInteraction extends BaseViewportInteraction {
  constructor(ctx: ViewportAdapterContext) {
    super(ctx);
  }

  private get spatial() {
    return this.ctx.hooks.spatial;
  }

  getCursor(): string | null {
    if (this.spatial.dragState) return 'cursor-grabbing';
    return null;
  }

  hasGlobalMouseCapture(): boolean {
    return Boolean(this.spatial.dragState);
  }

  handleMouseMove(event: ViewportPointerEvent): boolean {
    this.spatial.handleGlobalMouseMove(event.clientX, event.clientY);
    return !!this.spatial.dragState;
  }

  handleMouseUp(_event: ViewportPointerEvent): boolean {
    return this.spatial.handleMouseUp();
  }

  handleMouseLeave(): void {
    this.spatial.handleMouseLeave();
  }

  cleanupOnToolChange(_previousTool: string | null): void {
    this.spatial.cleanupOnToolChange(_previousTool);
  }

  shouldForceOverlays(): boolean {
    return this.spatial.shouldForceOverlays;
  }
}
