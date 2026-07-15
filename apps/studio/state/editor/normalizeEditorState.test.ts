import { describe, expect, it } from 'vitest';
import { BlendMode, ImageFitMode, NodeType, type AnyNode, type SceneNode } from '@blackboard/types';
import { buildProjectInitState } from '@/state/editor/actions';
import { ROOT_FLOW_ID } from '@/state/editor/flowModel';
import { getInitialState } from '@/state/editor/initialState';
import { normalizeEditorState } from '@/state/editor/normalizeEditorState';
import type { EditorState } from '@/state/editor/slices/types';
import { ColorManagementDefaults } from '@/color-management';

const createSceneNode = (): SceneNode => ({
  id: 'scene-1',
  type: NodeType.SCENE,
  name: 'Scene',
  enabled: true,
  width: 1920,
  height: 1080,
  bitDepth: 16,
  colorSpace: ColorManagementDefaults.WORKING_SPACE,
  startFrame: 0,
  maxFrames: 0,
  fps: 30,
});

const createImageNode = (): AnyNode =>
  ({
    id: 'image-1',
    type: NodeType.MEDIA_SOURCE,
    mediaKind: 'image',
    name: 'Image',
    enabled: true,
    src: 'asset-1',
    width: 1920,
    height: 1080,
    opacity: 100,
    operator: BlendMode.OVER,
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      fitMode: ImageFitMode.FIT,
    },
    colorSpace: ColorManagementDefaults.TEXTURE_SPACE,
  }) as AnyNode;

describe('normalizeEditorState', () => {
  it('keeps canonical project flows when a full reset also contains an empty node projection', () => {
    const imageNode = createImageNode();
    const { persistedState } = buildProjectInitState({
      nodes: [createSceneNode(), imageNode],
      selectedNodeId: imageNode.id,
    });
    const previousState = { ...getInitialState(), maxFrames: 0 } as EditorState;

    const nextState = normalizeEditorState(previousState, {
      ...getInitialState(),
      flows: persistedState.flows,
      rootFlowId: persistedState.rootFlowId,
      activeFlowId: persistedState.activeFlowId,
      selectedNodeId: imageNode.id,
      selectedNodeIds: [imageNode.id],
      maxFrames: 0,
    });

    expect(nextState.flows[ROOT_FLOW_ID]).toBe(persistedState.flows[ROOT_FLOW_ID]);
    expect(nextState.rootFlowId).toBe(ROOT_FLOW_ID);
    expect(nextState.activeFlowId).toBe(ROOT_FLOW_ID);
    expect(nextState.nodes.map((node) => node.id)).toEqual(['scene-1', 'image-1']);
    expect(nextState.selectedNodeIds).toEqual([imageNode.id]);
  });
});
