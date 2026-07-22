import * as THREE from 'three';
import { NodeType, type AnyNode } from '@blackboard/types';
import type { PaintNode } from '@blackboard/types';
import type { ResolveOutputContext } from '@blackboard/renderer';
import { NodeDefinition } from '../../NodeDefinition';
import PaintAdjustments from './PaintAdjustments';
import { PaintNodeIcon } from './PaintNodeIcon';
import PaintItemsPanel from './PaintItemsPanel';
import PaintTool from './PaintTool';
import PaintOverlay from './PaintOverlay';
import PaintViewportTools from './PaintViewportTools';
import PaintToolPanels from './PaintToolPanels';
import { DEFAULT_NEW_STROKE_LIFETIME } from './paintLifetime';
import { renderPaintGpu } from './paintGpuEngine';

export const paintNode: NodeDefinition = {
  type: NodeType.PAINT,
  name: 'Paint',
  category: 'Effect',
  renderMode: 'paint',
  processingDomain: 'scene_linear',
  // Paint edits straight image planes independently. Input alpha is copied or
  // edited only into output alpha; it never participates in output RGB.
  alphaInputBehavior: 'propagate',
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
    getAssetIds: () => [],
    checkFrameReady: () => true,
  },
  renderOutput: (
    node: AnyNode,
    target: THREE.WebGLRenderTarget,
    inputTexture: THREE.Texture | undefined,
    context: ResolveOutputContext,
  ): boolean => {
    return renderPaintGpu(node as PaintNode, target, inputTexture, context);
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
