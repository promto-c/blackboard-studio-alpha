import * as THREE from 'three';
import { NodeType, type AnyNode } from '@blackboard/types';
import type { ResolveOutputContext } from '@blackboard/renderer';
import { NodeDefinition } from '../../NodeDefinition';
import { PAINT_OVER_SHADER } from './paintShader';
import PaintAdjustments from './PaintAdjustments';
import { PaintNodeIcon } from './PaintNodeIcon';
import PaintItemsPanel from './PaintItemsPanel';
import PaintTool from './PaintTool';
import PaintOverlay from './PaintOverlay';
import PaintViewportTools from './PaintViewportTools';
import PaintToolPanels from './PaintToolPanels';
import { DEFAULT_NEW_STROKE_LIFETIME } from './paintLifetime';
import { isStoredPaintAssetId } from './paintRaster';

export const paintNode: NodeDefinition = {
  type: NodeType.PAINT,
  name: 'Paint',
  category: 'Effect',
  renderMode: 'paint',
  processingDomain: 'scene_linear',
  description: 'Brush, erase, and clone directly on the current composite.',
  IconComponent: PaintNodeIcon,
  ToolComponent: PaintTool,
  AdjustmentComponent: PaintAdjustments,
  ItemsComponent: PaintItemsPanel,
  ViewportToolsComponent: PaintViewportTools,
  ViewportToolPanelComponent: PaintToolPanels,
  defaultViewportTool: 'brush',
  flags: {
    isRenderable: true,
  },
  ViewportOverlayComponent: PaintOverlay,
  getClipboardHandlers: (_node, ctx) =>
    ctx.paintClipboard ?? {
      onCopy: () => false,
      onCut: () => false,
      onPaste: () => false,
    },
  getOverlayVisibility: (_node, ctx) => {
    if (ctx.viewport.showOverlays) return { forceShowSvg: false };
    return {
      forceShowSvg:
        ctx.viewport.activeViewportTool === 'brush' ||
        ctx.viewport.activeViewportTool === 'erase' ||
        ctx.viewport.activeViewportTool === 'clone',
    };
  },
  mediaDescriptor: {
    getAssetIds: (node) => {
      const paintNode = node as { strokes?: Array<{ raster?: string }> };
      return (paintNode.strokes ?? [])
        .map((stroke) => stroke.raster ?? '')
        .filter(isStoredPaintAssetId);
    },
    checkFrameReady: () => true,
  },
  renderOutput: (
    node: AnyNode,
    target: THREE.WebGLRenderTarget,
    inputTexture: THREE.Texture | undefined,
    context: ResolveOutputContext,
  ): boolean => {
    const paintTextures = context.getPaintTextures?.(node.id);
    if (!paintTextures) return false;
    const material = context.getMaterial(`${node.id}_paint`, PAINT_OVER_SHADER, {
      u_tDiffuse: { value: inputTexture ?? context.getTransparentInputTexture() },
      u_tPaint: { value: paintTextures.color },
      u_tPaintAlpha: { value: paintTextures.alpha },
    });
    context.applyNoBlending(material);
    context.clearRenderTargetTransparent(target);
    (context.quad as THREE.Mesh).material = material;
    context.renderer.setRenderTarget(target);
    context.renderer.render(context.scene, context.camera);
    return true;
  },
  getInitialNodeProps: () => ({
    strokes: [],
    layers: [],
    defaultLifetime: DEFAULT_NEW_STROKE_LIFETIME,
  }),
  toolHotkeys: {
    q: 'select',
    w: 'nudge',
    b: 'brush',
    e: 'erase',
    c: 'clone',
  },
  onNodeUpdate: (node, changes) => {
    if ('strokes' in changes || 'layers' in changes || 'defaultLifetime' in changes) {
      return { changes, label: `Edit ${node.name}` };
    }
    return { changes };
  },
};
