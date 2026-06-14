import { NodeType, type Scene3DNode } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import type { NodeDefinition } from '@/nodes/NodeDefinition';
import Scene3DAdjustments from './Scene3DAdjustments';
import Scene3DItemsPanel from './Scene3DItemsPanel';
import Scene3DToolButton from './Scene3DToolButton';
import { createDefaultScene3DSettings, normalizeScene3DSettings } from './scene3d';

export const scene3DNode: NodeDefinition = {
  type: NodeType.SCENE_3D,
  name: 'Scene 3D',
  description: 'Build and preview a 3D scene using the current 2D canvas as an output plane.',
  category: 'Utility',
  renderMode: 'utility',
  IconComponent: Icons.CubeTransparent,
  ToolComponent: Scene3DToolButton,
  AdjustmentComponent: Scene3DAdjustments,
  ItemsComponent: Scene3DItemsPanel,
  inputPorts: [
    {
      name: 'backdrop',
      label: 'Backdrop',
      type: 'texture',
      required: false,
      description:
        'Texture rendered onto the 3D output plane. When disconnected, the plane is empty.',
    },
  ],
  flags: {
    isRenderable: false,
    isDraggable: true,
  },
  getInitialNodeProps: () => ({
    viewportMode: 'scene3d',
    scene3d: createDefaultScene3DSettings(1920, 1080),
  }),
  mediaDescriptor: {
    getAssetIds: (node) =>
      ((node as Scene3DNode).scene3d?.items ?? [])
        .map((item) => item.asset?.assetId)
        .filter((assetId): assetId is string => Boolean(assetId)),
    checkFrameReady: () => true,
  },
  onNodeUpdate: (node, changes, context) => {
    const sceneNode = context.sceneNode as { width?: number; height?: number } | undefined;
    const canvasSize = {
      width: sceneNode?.width ?? 1920,
      height: sceneNode?.height ?? 1080,
    };
    const updated = { ...node, ...changes } as Scene3DNode;
    const finalChanges =
      'scene3d' in changes
        ? { ...changes, scene3d: normalizeScene3DSettings(updated, canvasSize) }
        : changes;

    if ('viewportMode' in changes) {
      return {
        changes: finalChanges,
        label: updated.viewportMode === 'scene3d' ? 'Switch to 3D View' : 'Switch to 2D Canvas',
      };
    }

    if ('scene3d' in changes) {
      return { changes: finalChanges, label: 'Update 3D Scene' };
    }

    return { changes: finalChanges };
  },
};
