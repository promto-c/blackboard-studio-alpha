import type { ViewportPointerEvent } from '@/nodes/NodeDefinition';
import type { ViewportAdapterContext } from '../viewportAdapterContext';
import { BaseViewportInteraction } from './BaseViewportInteraction';

/**
 * WarpViewportInteraction — adapts the warp interaction hook result
 * into a ViewportInteraction for registry-based dispatch.
 */
export class WarpViewportInteraction extends BaseViewportInteraction {
  constructor(ctx: ViewportAdapterContext) {
    super(ctx);
  }

  private get warp() {
    return this.ctx.hooks.warp;
  }

  getCursor(): string | null {
    const warp = this.warp;
    if (warp.dragPinState || warp.hoveredPinId) return 'cursor-grabbing';
    if (this.ctx.activeViewportTool === 'add_pin') return 'cursor-crosshair';
    return null;
  }

  hasGlobalMouseCapture(): boolean {
    return Boolean(this.warp.dragPinState);
  }

  handleMouseDown(event: ViewportPointerEvent): boolean {
    return this.warp.handleMouseDown(
      event.nativeEvent as unknown as React.MouseEvent<HTMLDivElement>,
      event.clientPoint,
      event.scenePoint,
    );
  }

  handleMouseMove(event: ViewportPointerEvent): boolean {
    return this.warp.handleMouseMove(event.nativeEvent, event.clientPoint);
  }

  handleMouseUp(_event: ViewportPointerEvent): boolean {
    return this.warp.handleMouseUp();
  }

  handleMouseLeave(): void {
    this.warp.handleMouseLeave();
  }

  cleanupOnToolChange(_previousTool: string | null): void {
    this.warp.cleanupOnToolChange(_previousTool);
  }

  shouldForceOverlays(): boolean {
    return this.warp.shouldForceOverlays;
  }
}
