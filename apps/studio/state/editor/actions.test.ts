import { describe, expect, it } from 'vitest';
import { BlendMode, ImageFitMode, NodeType, type AnyNode, type SceneNode } from '@blackboard/types';
import { OUTPUT_NODE_ID, ROOT_FLOW_ID } from '@/state/editor/flowModel';
import { buildProjectInitState } from '@/state/editor/actions';
import {
  ColorManagementDefaults,
  createBuiltinProjectColorConfigReference,
  createDefaultProjectColorManagement,
} from '@/color-management';

const createSceneNode = (): SceneNode => ({
  id: 'scene-1',
  type: NodeType.SCENE,
  name: 'Scene',
  enabled: true,
  width: 1920,
  height: 1080,
  bitDepth: 8,
  colorSpace: ColorManagementDefaults.WORKING_SPACE,
  startFrame: 0,
  maxFrames: 0,
  fps: 30,
});

const createImageNode = (): AnyNode => ({
  id: 'image-1',
  type: NodeType.MEDIA_SOURCE,
  mediaKind: 'image' as const,
  name: 'Image',
  enabled: true,
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
  colorSpace: ColorManagementDefaults.TEXTURE_SPACE,
});

describe('buildProjectInitState', () => {
  it('stores initial auto-layout positions in the new project history event', () => {
    const nodes: AnyNode[] = [createSceneNode(), createImageNode()];

    const { historyEntry, persistedState } = buildProjectInitState({
      nodes,
      selectedNodeId: 'image-1',
    });

    const nodePositions = historyEntry.state.nodePositionsByFlow?.[ROOT_FLOW_ID] ?? {};
    expect(Object.keys(nodePositions).sort()).toEqual(['image-1', OUTPUT_NODE_ID].sort());
    expect(persistedState.nodePositionsByFlow?.[ROOT_FLOW_ID]).toEqual(nodePositions);
    expect(persistedState.history[0]).toEqual(historyEntry);
    expect(persistedState.historyIndex).toBe(0);
    expect(persistedState.viewportWorkingArea).toEqual({
      enabled: false,
      rect: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(persistedState.flows[ROOT_FLOW_ID].edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: 'image-1',
        targetNodeId: OUTPUT_NODE_ID,
        targetPort: 'pipe',
      }),
    );
  });

  it('copies the selected color config reference into new project state', () => {
    const nodes: AnyNode[] = [createSceneNode(), createImageNode()];
    const selectedColorManagement = createDefaultProjectColorManagement({
      config: createBuiltinProjectColorConfigReference('ocio://show-config-v1'),
    });

    const { historyEntry, persistedState } = buildProjectInitState({
      nodes,
      selectedNodeId: 'image-1',
      colorManagement: selectedColorManagement,
    });

    const expectedConfig = {
      kind: 'builtin',
      id: 'show-config-v1',
      uri: 'ocio://show-config-v1',
    };
    expect(historyEntry.state.colorManagement?.config).toEqual(expectedConfig);
    expect(persistedState.colorManagement.config).toEqual(expectedConfig);
    expect(historyEntry.state.colorManagement).not.toBe(selectedColorManagement);
    expect(persistedState.colorManagement).not.toBe(selectedColorManagement);
    expect(persistedState.colorManagement).not.toBe(historyEntry.state.colorManagement);
  });
});
