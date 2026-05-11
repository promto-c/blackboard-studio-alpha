import { describe, expect, it } from 'vitest';
import {
  BlendMode,
  ImageFitMode,
  NodeType,
  type AnyNode,
  type ImageNode,
  type SceneNode,
} from '@blackboard/types';
import { OUTPUT_NODE_ID, ROOT_FLOW_ID } from '@/state/editor/flowModel';
import { buildProjectInitState } from '@/state/editor/actions';

const createSceneNode = (): SceneNode => ({
  id: 'scene-1',
  type: NodeType.SCENE,
  name: 'Scene',
  visible: true,
  width: 1920,
  height: 1080,
  bitDepth: 8,
  colorSpace: 'sRGB',
  maxFrames: 0,
  fps: 30,
});

const createImageNode = (): ImageNode => ({
  id: 'image-1',
  type: NodeType.IMAGE,
  name: 'Image',
  visible: true,
  src: 'asset-1',
  width: 1920,
  height: 1080,
  opacity: 1,
  operator: BlendMode.OVER,
  transform: {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    fitMode: ImageFitMode.FIT,
  },
  colorSpace: 'sRGB',
});

describe('buildProjectInitState', () => {
  it('stores initial auto-layout positions in the new project history event', () => {
    const nodes: AnyNode[] = [createSceneNode(), createImageNode()];

    const { historyEntry, persistedState, nodePositions } = buildProjectInitState({
      nodes,
      selectedNodeId: 'image-1',
    });

    expect(Object.keys(nodePositions).sort()).toEqual(
      ['image-1', OUTPUT_NODE_ID, 'scene-1'].sort(),
    );
    expect(historyEntry.state.nodePositionsByFlow?.[ROOT_FLOW_ID]).toEqual(nodePositions);
    expect(persistedState.nodePositionsByFlow?.[ROOT_FLOW_ID]).toEqual(nodePositions);
  });
});
