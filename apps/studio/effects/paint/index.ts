import { NodeType } from '@blackboard/types';
import { EffectDefinition } from '../EffectDefinition';
import PaintAdjustments from './PaintAdjustments';
import { PaintNodeIcon } from './PaintNodeIcon';
import PaintItemsPanel from './PaintItemsPanel';
import PaintTool from './PaintTool';
import PaintViewportTools from './PaintViewportTools';
import PaintToolPanels from './PaintToolPanels';
import { DEFAULT_NEW_STROKE_LIFETIME } from './paintLifetime';
import { isStoredPaintAssetId } from './paintRaster';

export const paintEffect: EffectDefinition = {
  type: NodeType.PAINT,
  name: 'Paint',
  category: 'Effect',
  renderMode: 'paint',
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
  getAssetIds: (node) => {
    const paintNode = node as { strokes?: Array<{ raster?: string }> };
    return (paintNode.strokes ?? [])
      .map((stroke) => stroke.raster ?? '')
      .filter(isStoredPaintAssetId);
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
