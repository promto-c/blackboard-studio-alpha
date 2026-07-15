import type { ViewportPointerEvent } from '@/nodes/NodeDefinition';
import type { ViewportAdapterContext } from '../viewportAdapterContext';
import { BaseViewportInteraction } from './BaseViewportInteraction';

/**
 * BokehViewportInteraction — adapts the bokeh interaction hook result
 * into a ViewportInteraction for registry-based dispatch.
 *
 * The simplest interaction adapter — only handles the focus-pick
 * cursor and mousedown. All other methods inherit no-op defaults
 * from BaseViewportInteraction.
 */
export class BokehViewportInteraction extends BaseViewportInteraction {
  constructor(ctx: ViewportAdapterContext) {
    super(ctx);
  }

  private get bokeh() {
    return this.ctx.hooks.bokeh;
  }

  getCursor(): string | null {
    if (this.ctx.activeViewportTool === 'bokeh_pick') return 'cursor-crosshair';
    return null;
  }

  handleMouseDown(event: ViewportPointerEvent): boolean {
    return this.bokeh.handleMouseDown(
      event.nativeEvent as unknown as React.MouseEvent<HTMLDivElement>,
      event.scenePoint,
    );
  }
}
