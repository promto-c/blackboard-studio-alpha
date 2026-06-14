import type { ViewportInteraction, ViewportPointerEvent } from '@/nodes/NodeDefinition';
import type { ViewportAdapterContext } from '../viewportAdapterContext';

/**
 * Base abstract class for viewport interaction adapters.
 *
 * Provides sensible no-op defaults for every method on `ViewportInteraction`,
 * so concrete subclasses only override the methods they actually implement.
 * This eliminates the repetitive boilerplate that was identical across all
 * interaction adapters (especially the simple ones like Bokeh, Comfy).
 *
 * @example
 * ```ts
 * export class BokehViewportInteraction extends BaseViewportInteraction {
 *   getCursor(): string | null {
 *     if (this.ctx.activeViewportTool === 'bokeh_pick') return 'cursor-crosshair';
 *     return null;
 *   }
 *   handleMouseDown(event: ViewportPointerEvent): boolean { ... }
 * }
 * ```
 */
export abstract class BaseViewportInteraction implements ViewportInteraction {
  constructor(protected ctx: ViewportAdapterContext) {}

  // ── Cursor ────────────────────────────────────────────────────────
  getCursor(): string | null {
    return null;
  }

  // ── Preview / capture ─────────────────────────────────────────────
  isPreviewActive(): boolean {
    return false;
  }

  hasGlobalMouseCapture(): boolean {
    return false;
  }

  // ── Mouse handlers ────────────────────────────────────────────────
  handleMouseDown(_event: ViewportPointerEvent): boolean {
    return false;
  }

  handleMouseMove(_event: ViewportPointerEvent): boolean {
    return false;
  }

  handleMouseUp(_event: ViewportPointerEvent): boolean {
    return false;
  }

  handleMouseLeave(): void {
    // no-op by default
  }

  // ── Tool changes ──────────────────────────────────────────────────
  cleanupOnToolChange(_previousTool: string | null): void {
    // no-op by default
  }

  // ── Overlays ──────────────────────────────────────────────────────
  shouldForceOverlays(): boolean {
    return false;
  }

  // ── Commands ──────────────────────────────────────────────────────
  handleCommand(_commandId: string): boolean {
    return false;
  }
}
