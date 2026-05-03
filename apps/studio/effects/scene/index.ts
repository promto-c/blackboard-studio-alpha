import { NodeType, SceneNode } from '@blackboard/types';
import { EffectDefinition } from '../EffectDefinition';
import SceneAdjustments from './SceneAdjustments';
import * as Icons from '@blackboard/icons';

export const sceneEffect: EffectDefinition = {
  type: NodeType.SCENE,
  name: 'Scene',
  category: 'Image', // Not really, but doesn't have a tool
  renderMode: 'scene',
  IconComponent: Icons.BuildingStorefront,
  AdjustmentComponent: SceneAdjustments,
  flags: {
    isSceneLike: true,
    isProtected: true,
    isDraggable: false,
  },
  getInitialNodeProps: () => ({
    width: 1920,
    height: 1080,
    bitDepth: 8,
    colorSpace: 'sRGB',
    maxFrames: 120,
    fps: 30,
  }),
  onNodeUpdate: (node, changes) => {
    const updated = { ...node, ...changes } as SceneNode;
    let label: string | undefined;

    if ('width' in changes || 'height' in changes) {
      label = `Set Resolution to ${updated.width}x${updated.height}`;
    } else if ('bitDepth' in changes) {
      label = `Set Bit Depth to ${updated.bitDepth === 8 ? '8-bit integer' : `${updated.bitDepth}-bit float`}`;
    } else if ('colorSpace' in changes) {
      label = `Set Color Space to ${updated.colorSpace}`;
    } else if ('fps' in changes) {
      label = `Set FPS to ${updated.fps}`;
    }

    return { changes, label };
  },
};
