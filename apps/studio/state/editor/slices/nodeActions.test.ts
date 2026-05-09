import { describe, expect, it, vi } from 'vitest';

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(),
  Modality: {},
  Type: {},
}));

vi.mock('@/effects/effectRegistry', () => ({
  effectRegistry: new Map([
    ['scene', { category: 'Scene', renderMode: 'source', getInitialNodeProps: () => ({}) }],
    [
      'image',
      {
        category: 'Image',
        renderMode: 'source',
        flags: { isSource: true },
        getInitialNodeProps: () => ({}),
      },
    ],
    ['grade', { category: 'Adjustment', renderMode: 'shader', getInitialNodeProps: () => ({}) }],
    ['blur', { category: 'Effect', renderMode: 'multipass', getInitialNodeProps: () => ({}) }],
  ]),
}));

import { NodeType } from '@blackboard/types';
import type { AnyNode } from '@blackboard/types';
import { createNodeActions } from '@/state/editor/slices/nodeActions';

type TestState = {
  nodes: AnyNode[];
  currentFrame: number;
  selectedNodeId: string | null;
  nodePositions?: Record<string, { x: number; y: number }>;
  nodePositionsByFlow?: Record<string, Record<string, { x: number; y: number }>>;
};

const createHarness = (nodeOrNodes: AnyNode | AnyNode[], currentFrame = 24) => {
  const nodes = Array.isArray(nodeOrNodes) ? nodeOrNodes : [nodeOrNodes];
  let state: TestState = {
    nodes,
    currentFrame,
    selectedNodeId: nodes[0]?.id ?? null,
  };

  const set = (fn: (prevState: TestState) => Partial<TestState> | TestState) => {
    state = { ...state, ...fn(state) };
  };
  const get = () => state;
  const pushHistory = vi.fn();
  const actions = createNodeActions(set as never, get as never, {
    pushHistory,
    debouncedSave: vi.fn(),
  });

  return {
    actions,
    pushHistory,
    getState: () => state,
  };
};

const scene = (id = 'scene'): AnyNode =>
  ({
    id,
    type: NodeType.SCENE,
    name: 'Scene',
    visible: true,
    width: 1920,
    height: 1080,
    bitDepth: 8,
    colorSpace: 'sRGB',
    maxFrames: 1,
    fps: 24,
  }) as AnyNode;

const image = (id: string): AnyNode =>
  ({ id, type: NodeType.IMAGE, name: id, visible: true }) as AnyNode;

const grade = (id: string, stacked = false): AnyNode =>
  ({ id, type: NodeType.GRADE, name: id, visible: true, stacked }) as AnyNode;

const legacyGrade = (id: string): AnyNode =>
  ({ id, type: NodeType.GRADE, name: id, visible: true }) as AnyNode;

const blur = (id: string, stacked = false): AnyNode =>
  ({ id, type: NodeType.BLUR, name: id, visible: true, stacked }) as AnyNode;

describe('createNodeActions addNode', () => {
  it('does not stack a new adjustment when a source node is selected', () => {
    const nodes = [scene(), image('image-1')];
    const { actions, getState } = createHarness(nodes);
    getState().selectedNodeId = 'image-1';

    actions.addNode(NodeType.GRADE);

    const addedNode = getState().nodes.find((node) => node.type === NodeType.GRADE);
    expect(addedNode).toBeDefined();
    expect(addedNode).not.toHaveProperty('stacked');
  });

  it('does not stack a new adjustment when a stacked adjustment is selected', () => {
    const nodes = [scene(), image('image-1'), grade('grade-1', true)];
    const { actions, getState } = createHarness(nodes);
    getState().selectedNodeId = 'grade-1';

    actions.addNode(NodeType.BLUR);

    const addedNode = getState().nodes.find((node) => node.type === NodeType.BLUR);
    expect(addedNode).toBeDefined();
    expect(addedNode).not.toHaveProperty('stacked');
  });
});

describe('createNodeActions history frame targeting', () => {
  it('pushes the affected target frame when setting a keyframe off the playhead', () => {
    const node = {
      id: 'node-1',
      type: NodeType.GRADE,
      name: 'Grade 1',
      visible: true,
      opacity: 0.5,
    } as unknown as AnyNode;
    const { actions, pushHistory } = createHarness(node, 12);

    actions.setKeyframe(node.id, 'opacity', 0.75, true, 48, true);

    expect(pushHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Set Keyframe',
        state: expect.objectContaining({
          currentFrame: 48,
          selectedNodeId: node.id,
        }),
      }),
    );
  });

  it('pushes the moved keyframe frame when updating a keyframe position', () => {
    const node = {
      id: 'node-1',
      type: NodeType.GRADE,
      name: 'Grade 1',
      visible: true,
      opacity: [{ frame: 12, value: 0.5 }],
    } as unknown as AnyNode;
    const { actions, pushHistory } = createHarness(node, 12);

    actions.updateKeyframe(node.id, 'opacity', 12, { frame: 36 }, true);

    expect(pushHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Update Keyframe',
        state: expect.objectContaining({
          currentFrame: 36,
          selectedNodeId: node.id,
        }),
      }),
    );
  });
});

describe('createNodeActions stackNodeOntoStack', () => {
  it('stacks an unstacked adjustment that has no stacked flag', () => {
    const nodes = [scene(), image('image-1'), legacyGrade('grade-1')];
    const { actions, getState, pushHistory } = createHarness(nodes);

    actions.toggleNodeStacking('grade-1');

    expect(getState().nodes.find((node) => node.id === 'grade-1')).toEqual(
      expect.objectContaining({ stacked: true }),
    );
    expect(pushHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Stack grade-1',
      }),
    );
  });

  it('does not stack the first non-scene adjustment onto Scene', () => {
    const nodes = [scene(), legacyGrade('grade-1')];
    const { actions, getState, pushHistory } = createHarness(nodes);

    actions.toggleNodeStacking('grade-1');

    expect(getState().nodes.find((node) => node.id === 'grade-1')).not.toHaveProperty('stacked');
    expect(pushHistory).not.toHaveBeenCalled();
  });

  it('marks the moved adjustment as stacked and inserts it after the target stack', () => {
    const nodes = [scene(), image('image-1'), grade('grade-1'), blur('blur-1')];
    const { actions, getState, pushHistory } = createHarness(nodes);

    const didStack = actions.stackNodeOntoStack('grade-1', 'image-1');

    expect(didStack).toBe(true);
    expect(getState().nodes.map((node) => node.id)).toEqual([
      'scene',
      'image-1',
      'grade-1',
      'blur-1',
    ]);
    expect(getState().nodes.find((node) => node.id === 'grade-1')).toEqual(
      expect.objectContaining({ stacked: true }),
    );
    expect(pushHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Stack grade-1',
        state: expect.objectContaining({
          nodes: getState().nodes,
        }),
      }),
    );
  });

  it('moves an adjustment stack as a group and removes the old graph position', () => {
    const nodes = [
      scene(),
      image('image-1'),
      grade('grade-1'),
      blur('blur-1', true),
      image('image-2'),
    ];
    const { actions, getState } = createHarness(nodes);
    getState().nodePositions = {
      'image-1': { x: 0, y: 0 },
      'grade-1': { x: 0, y: 100 },
      'image-2': { x: 0, y: 200 },
    };

    const didStack = actions.stackNodeOntoStack('grade-1', 'image-2');

    expect(didStack).toBe(true);
    expect(getState().nodes.map((node) => node.id)).toEqual([
      'scene',
      'image-1',
      'image-2',
      'grade-1',
      'blur-1',
    ]);
    expect(getState().nodes.find((node) => node.id === 'grade-1')).toEqual(
      expect.objectContaining({ stacked: true }),
    );
    expect(getState().nodePositions).not.toHaveProperty('grade-1');
  });

  it('does not stack source nodes', () => {
    const nodes = [scene(), image('image-1'), image('image-2')];
    const { actions, getState, pushHistory } = createHarness(nodes);

    expect(actions.stackNodeOntoStack('image-2', 'image-1')).toBe(false);
    expect(getState().nodes.map((node) => node.id)).toEqual(['scene', 'image-1', 'image-2']);
    expect(pushHistory).not.toHaveBeenCalled();
  });
});
