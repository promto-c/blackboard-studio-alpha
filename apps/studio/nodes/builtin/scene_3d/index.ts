import { NodeType, type Scene3DNode } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { isPromiseLike } from '@blackboard/renderer';
import type { NodeDefinition } from '@/nodes/NodeDefinition';
import {
  prepareScene3DProjectionAssets,
  renderScene3DToTarget,
  renderScene3DToTargetAsync,
} from '@/renderer/scene3dRenderer';
import Scene3DAdjustments from './Scene3DAdjustments';
import Scene3DItemsPanel from './Scene3DItemsPanel';
import Scene3DToolButton from './Scene3DToolButton';
import { createDefaultScene3DSettings, normalizeScene3DSettings } from './scene3d';

export const scene3DNode: NodeDefinition = {
  type: NodeType.SCENE_3D,
  name: 'Scene 3D',
  description: 'Build and render a 3D scene using the current 2D canvas as an output plane.',
  category: 'Utility',
  renderMode: 'utility',
  renderOutputContract: 'pipeline',
  processingDomain: 'scene_linear',
  IconComponent: Icons.CubeTransparent,
  ToolComponent: Scene3DToolButton,
  AdjustmentComponent: Scene3DAdjustments,
  ItemsComponent: Scene3DItemsPanel,
  inputPorts: [
    {
      name: 'backdrop',
      label: 'Backdrop',
      type: 'texture',
      processingDomain: 'scene_linear',
      required: false,
      description:
        'Texture rendered onto the 3D output plane. When disconnected, the plane is empty.',
    },
  ],
  outputPorts: [
    {
      name: 'output',
      label: 'Output',
      processingDomain: 'scene_linear',
      description: 'Scene-linear 3D render for compositing and display/view output.',
    },
  ],
  flags: {
    isRenderable: true,
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
  renderOutput: (node, target, _inputTexture, context) => {
    const scene3D = node as Scene3DNode;
    const backdropNodeId = scene3D.inputs?.backdrop;
    const backdropResult = backdropNodeId
      ? context.resolveOutput(backdropNodeId, context.getInputSourcePort(scene3D, 'backdrop'))
      : undefined;

    const render = (backdropTexture: typeof _inputTexture) => {
      const renderOptions = {
        renderer: context.renderer,
        target,
        node: scene3D,
        sceneNode: context.sceneNode,
        backdropTexture,
        transformColorPickingToSceneLinear: context.transformColorPickingToSceneLinear,
        clearRenderTargetTransparent: context.clearRenderTargetTransparent,
      };

      if (context.executionMode !== 'async') {
        return renderScene3DToTarget(renderOptions);
      }

      return prepareScene3DProjectionAssets({
        renderer: context.renderer,
        node: scene3D,
        sceneNode: context.sceneNode,
        transformColorPickingToSceneLinear: context.transformColorPickingToSceneLinear,
      }).then(() => renderScene3DToTargetAsync(renderOptions));
    };

    return backdropResult && isPromiseLike(backdropResult)
      ? backdropResult.then(render)
      : render(backdropResult);
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
