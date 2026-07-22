import type { ViewportPointerEvent } from '@/nodes/NodeDefinition';
import { getTransformHandleCursor } from '@/utils/rotoTransform';
import type { ViewportAdapterContext } from '../viewportAdapterContext';
import { BaseViewportInteraction } from './BaseViewportInteraction';

/**
 * RotoViewportInteraction — adapts the roto interaction hook result
 * into a plain ViewportInteraction object.
 *
 * Created once per roto-node selection. Reads from the mutable
 * ViewportAdapterContext (updated every render) so cursor/mouse
 * methods always see the latest state.
 */
export class RotoViewportInteraction extends BaseViewportInteraction {
  constructor(ctx: ViewportAdapterContext) {
    super(ctx);
  }

  private get roto() {
    return this.ctx.hooks.roto;
  }

  getCursor(): string | null {
    const roto = this.roto;

    if (roto.transformDragState) return 'cursor-grabbing';
    if (roto.hoveredTransformHandle)
      return getTransformHandleCursor(
        roto.hoveredTransformHandle,
        this.ctx.affineModifierPressed,
        this.ctx.altPressed,
      );
    if (roto.nudgeDragState || roto.insertedPointDragState) return 'cursor-grabbing';
    if (roto.dragPointState) return 'cursor-move';
    if (roto.isHoveringClosePoint || roto.hoveredSegment) return 'cursor-pointer';
    if (
      this.ctx.activeViewportTool === 'segment-point' ||
      this.ctx.activeViewportTool === 'segment-box' ||
      this.ctx.activeViewportTool === 'rectangle' ||
      this.ctx.activeViewportTool === 'bspline' ||
      this.ctx.activeViewportTool === 'freehand'
    )
      return 'cursor-crosshair';
    if (this.ctx.activeViewportTool === 'nudge' || roto.isAdjustingRadius) return 'cursor-none';
    if (roto.isRotoSelectActive) return 'cursor-default';
    return null;
  }

  isPreviewActive(): boolean {
    return this.roto.isEditingRotoPaths;
  }

  hasGlobalMouseCapture(): boolean {
    const roto = this.roto;
    return Boolean(
      roto.dragPointState ||
      roto.transformDragState ||
      roto.nudgeDragState ||
      roto.pointWeightDragState ||
      roto.insertedPointDragState ||
      roto.marqueeState ||
      roto.drawingState ||
      roto.freehandPoints ||
      roto.dragNewPointIndex !== null ||
      roto.isAdjustingRadius ||
      roto.segmentationSession.boxDraft,
    );
  }

  handleMouseDown(event: ViewportPointerEvent): boolean {
    if (
      this.roto.handleSegmentationMouseDown(
        event.nativeEvent as unknown as React.MouseEvent<HTMLDivElement>,
        event.scenePoint,
      )
    ) {
      return true;
    }
    return this.roto.handleMouseDown(
      event.nativeEvent as unknown as React.MouseEvent<HTMLDivElement>,
      event.clientPoint,
      event.scenePoint,
    );
  }

  handleMouseMove(event: ViewportPointerEvent): boolean {
    if (this.roto.handleSegmentationMouseMove(event.scenePoint, event.modifiers)) return true;
    return this.roto.handleMouseMove(event.nativeEvent, event.clientPoint, event.scenePoint);
  }

  handleMouseUp(event: ViewportPointerEvent): boolean {
    if (this.roto.handleSegmentationMouseUp(event.scenePoint, event.button)) return true;
    return this.roto.handleMouseUp(event.nativeEvent);
  }

  handleMouseLeave(): void {
    this.roto.cancelSegmentationPreview();
    this.roto.handleMouseLeave();
  }

  cleanupOnToolChange(_previousTool: string | null): void {
    if (_previousTool?.startsWith('segment-')) this.roto.cancelSegmentationPreview();
    this.roto.cleanupOnToolChange?.(_previousTool);
  }

  handleContextMenu(event: ViewportPointerEvent): boolean {
    if (this.ctx.activeViewportTool?.startsWith('segment-')) {
      event.nativeEvent.preventDefault();
      return true;
    }
    this.roto.handleContextMenu(event.nativeEvent as unknown as React.MouseEvent<HTMLDivElement>);
    return true;
  }

  shouldForceOverlays(): boolean {
    return this.roto.shouldForceOverlays;
  }

  handleCommand(commandId: string): boolean {
    if (commandId === 'commitRotoRefinement') {
      if (!this.ctx.rotoRefinement) return false;
      this.ctx.commitRotoRefinement();
      return true;
    }
    if (commandId === 'deleteNudgeSelection') {
      return this.roto.deletePointsInNudgeArea();
    }
    return false;
  }
}
