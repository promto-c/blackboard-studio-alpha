/**
 * Barrel export for viewport interaction adapter classes.
 *
 * Module-level side-effect block registers the adapter factories
 * on node definitions at import time. Named exports are only the
 * symbols consumed by other files — the adapter classes themselves
 * are only referenced here via side-effect registration.
 */
import { RotoViewportInteraction } from './rotoViewportInteraction';
import { PaintViewportInteraction } from './paintViewportInteraction';
import { WarpViewportInteraction } from './warpViewportInteraction';
import { SpatialViewportInteraction } from './spatialViewportInteraction';
import { BokehViewportInteraction } from './bokehViewportInteraction';
import { KeyerViewportInteraction } from './keyerViewportInteraction';
import { ComfyViewportInteraction } from './comfyViewportInteraction';
import { noopViewportInteraction } from './BaseViewportInteraction';

export { noopViewportInteraction };

// ── Register adapter factories on node definitions ─────────────────
import { rotoNode } from '@/nodes/builtin/roto';
import { paintNode } from '@/nodes/builtin/paint';
import { warpNode } from '@/nodes/spatial/warp';
import { transformNode } from '@/nodes/spatial/transform';
import { bokehNode } from '@/nodes/effects/bokeh';
import { keyerNode } from '@/nodes/effects/keyer';
import { comfyNode } from '@/nodes/ai/comfy';
import type { ViewportAdapterContext } from '../viewportAdapterContext';
import type { ViewportInteraction } from '@/nodes/NodeDefinition';

/**
 * Helper that creates a `createViewportInteraction` factory function,
 * centralising the `as unknown as ViewportAdapterContext` cast so it
 * only appears in one place instead of six.
 */
function adapter<T extends ViewportInteraction>(
  AdapterClass: new (ctx: ViewportAdapterContext) => T,
): (ctx: unknown) => T {
  return (ctx: unknown) => new AdapterClass(ctx as ViewportAdapterContext);
}

rotoNode.createViewportInteraction = adapter(RotoViewportInteraction);
paintNode.createViewportInteraction = adapter(PaintViewportInteraction);
warpNode.createViewportInteraction = adapter(WarpViewportInteraction);
transformNode.createViewportInteraction = adapter(SpatialViewportInteraction);
bokehNode.createViewportInteraction = adapter(BokehViewportInteraction);
keyerNode.createViewportInteraction = adapter(KeyerViewportInteraction);
comfyNode.createViewportInteraction = adapter(ComfyViewportInteraction);
