import type { ViewportPointerEvent } from '@/nodes/NodeDefinition';
import type { ViewportAdapterContext } from '../viewportAdapterContext';
import { BaseViewportInteraction } from './BaseViewportInteraction';

/**
 * PaintViewportInteraction — adapts the paint interaction hook result
 * into a ViewportInteraction for registry-based dispatch.
 */
export class PaintViewportInteraction extends BaseViewportInteraction {
  constructor(ctx: ViewportAdapterContext) {
    super(ctx);
  }

  private get paint() {
    return this.ctx.hooks.paint;
  }

  getCursor(): string | null {
    const paint = this.paint;
    const tool = this.ctx.activeViewportTool;

    if (paint.isAdjustingBrushSize) return 'cursor-none';
    if (tool === 'brush' || tool === 'erase' || tool === 'clone') return 'cursor-crosshair';
    if (tool === 'nudge' || paint.isAdjustingNudgeRadius) return 'cursor-none';
    return null;
  }

  hasGlobalMouseCapture(): boolean {
    const paint = this.paint;
    return Boolean(
      paint.isPainting ||
      paint.isSettingCloneSource ||
      paint.isAdjustingBrushSize ||
      paint.nudgeDragState ||
      paint.isAdjustingNudgeRadius,
    );
  }

  handleMouseDown(event: ViewportPointerEvent): boolean {
    return this.paint.handleMouseDown(
      event.nativeEvent as unknown as React.MouseEvent<HTMLDivElement>,
      { x: event.clientX, y: event.clientY },
      { x: event.sceneX, y: event.sceneY },
    );
  }

  handleMouseMove(event: ViewportPointerEvent): boolean {
    return this.paint.handleMouseMove(
      event.nativeEvent,
      { x: event.clientX, y: event.clientY },
      {
        x: event.sceneX,
        y: event.sceneY,
      },
    );
  }

  handleMouseUp(event: ViewportPointerEvent): boolean {
    return this.paint.handleMouseUp(event.nativeEvent);
  }

  handleMouseLeave(): void {
    this.paint.handleMouseLeave();
  }

  cleanupOnToolChange(_previousTool: string | null): void {
    this.paint.cleanupOnToolChange(_previousTool);
  }

  shouldForceOverlays(): boolean {
    return this.paint.shouldForceOverlays;
  }
}
