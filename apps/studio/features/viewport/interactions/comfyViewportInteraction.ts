import type { ViewportPointerEvent } from '@/nodes/NodeDefinition';
import type { ViewportAdapterContext } from '../viewportAdapterContext';
import { BaseViewportInteraction } from './BaseViewportInteraction';
import { COMFY_CROP_VIEWPORT_TOOL } from '@/nodes/ai/comfy/comfyViewportBindings';

/**
 * ComfyViewportInteraction — adapts the comfy crop interaction hook
 * into a ViewportInteraction for registry-based dispatch.
 */
export class ComfyViewportInteraction extends BaseViewportInteraction {
  constructor(ctx: ViewportAdapterContext) {
    super(ctx);
  }

  private get comfyCrop() {
    return this.ctx.hooks.comfyCrop;
  }

  getCursor(): string | null {
    if (this.ctx.activeViewportTool === COMFY_CROP_VIEWPORT_TOOL) return 'cursor-crosshair';
    return null;
  }

  hasGlobalMouseCapture(): boolean {
    return Boolean(this.comfyCrop.dragState);
  }

  handleMouseDown(event: ViewportPointerEvent): boolean {
    return this.comfyCrop.handleMouseDown(
      event.nativeEvent as unknown as React.MouseEvent<HTMLDivElement>,
      { x: event.clientX, y: event.clientY },
      { x: event.sceneX, y: event.sceneY },
    );
  }

  handleMouseMove(event: ViewportPointerEvent): boolean {
    return this.comfyCrop.handleMouseMove(
      event.nativeEvent,
      { x: event.clientX, y: event.clientY },
      {
        x: event.sceneX,
        y: event.sceneY,
      },
    );
  }

  handleMouseUp(_event: ViewportPointerEvent): boolean {
    this.comfyCrop.handleMouseUp();
    return false;
  }

  cleanupOnToolChange(_previousTool: string | null): void {
    this.comfyCrop.cleanupOnToolChange();
  }

  shouldForceOverlays(): boolean {
    return this.comfyCrop.shouldForceOverlays;
  }

  handleCommand(commandId: string): boolean {
    if (commandId === 'deleteComfyRegion') {
      return this.comfyCrop.deleteSelectedRegion();
    }
    return false;
  }
}
