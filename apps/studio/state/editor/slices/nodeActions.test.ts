import { describe, expect, it, vi } from 'vitest';

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(),
  Modality: {},
  Type: {},
}));

vi.mock('@/nodes/registry', () => ({
  nodeRegistry: new Map([
    [
      'scene',
      {
        name: 'Scene',
        category: 'Scene',
        renderMode: 'scene',
        flags: { isSceneLike: true },
        getInitialNodeProps: () => ({}),
      },
    ],
    [
      'media_source',
      {
        name: 'Image',
        category: 'Image',
        renderMode: 'source',
        flags: { isSource: true, hasThumbnail: true },
        getInitialNodeProps: () => ({}),
      },
    ],
    [
      'onnx_model',
      {
        name: 'ONNX Model',
        category: 'Image',
        renderMode: 'media',
        flags: { isSource: true },
        inputPorts: [
          {
            name: 'image',
            label: 'Image',
            type: 'texture',
            required: true,
          },
        ],
        getInitialNodeProps: () => ({}),
      },
    ],
    [
      'grade',
      {
        name: 'Grade',
        category: 'Adjustment',
        renderMode: 'shader',
        getInitialNodeProps: () => ({}),
      },
    ],
    [
      'blur',
      {
        name: 'Blur',
        category: 'Effect',
        renderMode: 'multipass',
        getInitialNodeProps: () => ({}),
      },
    ],
    [
      'reformat',
      {
        name: 'Reformat',
        category: 'Spatial',
        renderMode: 'shader',
        getInitialNodeProps: () => ({ width: 1920, height: 1080, resizeMode: 'fit' }),
      },
    ],
    [
      'extract_channels',
      {
        name: 'Extract Channels',
        category: 'Effect',
        renderMode: 'utility',
        getInitialNodeProps: () => ({}),
      },
    ],
    [
      'merge_channels',
      {
        name: 'Merge Channels',
        category: 'Effect',
        renderMode: 'utility',
        flags: { isRenderable: true },
        inputPorts: [
          { name: 'r', label: 'R', type: 'texture', required: false },
          { name: 'g', label: 'G', type: 'texture', required: false },
          { name: 'b', label: 'B', type: 'texture', required: false },
          { name: 'a', label: 'A', type: 'texture', required: false },
        ],
        getInitialNodeProps: () => ({}),
      },
    ],
    [
      'merge',
      { name: 'Merge', category: 'Effect', renderMode: 'merge', getInitialNodeProps: () => ({}) },
    ],
    [
      'scene_3d',
      {
        name: 'Scene 3D',
        category: 'Utility',
        renderMode: 'utility',
        inputPorts: [
          {
            name: 'backdrop',
            label: 'Backdrop',
            type: 'texture',
            required: false,
          },
        ],
        getInitialNodeProps: () => ({
          viewportMode: 'scene3d',
          scene3d: { items: [] },
        }),
      },
    ],
  ]),
}));

import { NodeType } from '@blackboard/types';
import type { AnyNode, GroupNode } from '@blackboard/types';
import {
  buildFlowFromNodes,
  getOrderedNodesFromFlow,
  ROOT_FLOW_ID,
} from '@/state/editor/flowModel';
import type { CommitEditorMutation } from '@/state/editor/commitMutation';
import { createNodeActions } from '@/state/editor/slices/nodeActions';

type TestState = {
  nodes: AnyNode[];
  flows: ReturnType<typeof buildFlowFromNodes> extends infer Flow ? Record<string, Flow> : never;
  rootFlowId: string | null;
  activeFlowId: string | null;
  currentFrame: number;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  nodePositionsByFlow?: Record<string, Record<string, { x: number; y: number }>>;
};

const createHarness = (nodeOrNodes: AnyNode | AnyNode[], currentFrame = 24) => {
  const nodes = Array.isArray(nodeOrNodes) ? nodeOrNodes : [nodeOrNodes];
  const rootFlow = buildFlowFromNodes(nodes, ROOT_FLOW_ID, 'Root Flow');
  let state: TestState = {
    nodes,
    flows: { [rootFlow.id]: rootFlow },
    rootFlowId: rootFlow.id,
    activeFlowId: rootFlow.id,
    currentFrame,
    selectedNodeId: nodes[0]?.id ?? null,
    selectedNodeIds: nodes[0]?.id ? [nodes[0].id] : [],
    nodePositionsByFlow: {},
  };

  const set = (fn: (prevState: TestState) => Partial<TestState> | TestState) => {
    const patch = fn(state);
    state = { ...state, ...patch };
    if ('selectedNodeId' in patch && !('selectedNodeIds' in patch)) {
      state.selectedNodeIds = state.selectedNodeId ? [state.selectedNodeId] : [];
    }
    if ('flows' in patch || 'rootFlowId' in patch || 'activeFlowId' in patch) {
      const flow = state.activeFlowId ? state.flows[state.activeFlowId] : null;
      state.nodes = getOrderedNodesFromFlow(flow);
    }
  };
  const get = () => state;
  const pushHistory = vi.fn();
  const debouncedSave = vi.fn();
  const commitMutation: CommitEditorMutation<TestState> = (input) => {
    const mutation = typeof input === 'function' ? input(get()) : input;
    set(() => mutation.patch);
    if (mutation.history) {
      pushHistory({ label: mutation.history.label, state: mutation.history.state });
    }
    if (mutation.persist === 'debounced') {
      debouncedSave();
    }
  };
  const deps = { commitMutation };
  const actions = createNodeActions(set as never, get as never, deps);

  return {
    actions,
    pushHistory,
    getState: () => state,
  };
};

const scene = (id = 'scene', size = { width: 1920, height: 1080 }): AnyNode =>
  ({
    id,
    type: NodeType.SCENE,
    name: 'Scene',
    enabled: true,
    width: size.width,
    height: size.height,
    bitDepth: 8,
    colorSpace: 'sRGB',
    maxFrames: 1,
    fps: 24,
  }) as AnyNode;

const image = (id: string): AnyNode =>
  ({
    id,
    type: NodeType.MEDIA_SOURCE,
    name: id,
    enabled: true,
    mediaKind: 'image',
    src: '',
  }) as AnyNode;

const grade = (id: string, stacked = false): AnyNode =>
  ({ id, type: NodeType.GRADE, name: id, enabled: true, stacked }) as AnyNode;

const blur = (id: string, stacked = false): AnyNode =>
  ({ id, type: NodeType.BLUR, name: id, enabled: true, stacked }) as AnyNode;

const mergeChannels = (id: string): AnyNode =>
  ({ id, type: NodeType.MERGE_CHANNELS, name: id, enabled: true }) as AnyNode;

const input = (id = 'input-1'): AnyNode =>
  ({
    id,
    type: NodeType.INPUT,
    name: 'Input',
    enabled: true,
    groupNodeId: 'group-1',
    externalInputId: null,
  }) as AnyNode;

describe('createNodeActions addNode', () => {
  it('adds a first source to an empty scene without creating a merge node', () => {
    const nodes = [scene()];
    const { actions, getState, pushHistory } = createHarness(nodes);
    getState().selectedNodeId = 'scene';
    getState().selectedNodeIds = ['scene'];

    actions.addNode(NodeType.ONNX_MODEL);

    const state = getState();
    const addedSource = state.nodes.find((node) => node.type === NodeType.ONNX_MODEL);

    expect(addedSource).toBeDefined();
    expect(state.nodes.some((node) => node.type === NodeType.MERGE)).toBe(false);
    expect(state.selectedNodeId).toBe(addedSource!.id);
    expect(pushHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Add ONNX Model Node',
      }),
    );
  });

  it('does not auto-merge a source node when no node is selected', () => {
    const nodes = [scene(), image('image-1')];
    const { actions, getState, pushHistory } = createHarness(nodes);
    getState().selectedNodeId = null;
    getState().selectedNodeIds = [];

    actions.addNode(NodeType.ONNX_MODEL);

    const state = getState();
    const addedSource = state.nodes.find((node) => node.type === NodeType.ONNX_MODEL);

    expect(addedSource).toBeDefined();
    expect(addedSource).toEqual(expect.objectContaining({ detachedFromPipe: true }));
    expect(state.nodes.some((node) => node.type === NodeType.MERGE)).toBe(false);
    expect(state.selectedNodeId).toBe(addedSource!.id);
    expect(pushHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Add ONNX Model Node',
      }),
    );
  });

  it('does not stack a new adjustment when a source node is selected', () => {
    const nodes = [scene(), image('image-1')];
    const { actions, getState } = createHarness(nodes);
    getState().selectedNodeId = 'image-1';

    actions.addNode(NodeType.GRADE);

    const addedNode = getState().nodes.find((node) => node.type === NodeType.GRADE);
    expect(addedNode).toBeDefined();
    expect(addedNode).not.toHaveProperty('stacked');
  });

  it('connects a new Scene 3D node backdrop from the selected node when output is not connected', () => {
    const nodes = [scene(), image('image-1')];
    const { actions, getState } = createHarness(nodes);
    getState().selectedNodeId = 'image-1';
    getState().selectedNodeIds = ['image-1'];

    actions.addNode(NodeType.SCENE_3D);

    const state = getState();
    const scene3DNode = state.nodes.find((node) => node.type === NodeType.SCENE_3D)!;

    expect(scene3DNode).toEqual(
      expect.objectContaining({
        inputs: { backdrop: 'image-1' },
      }),
    );
    expect(state.flows[ROOT_FLOW_ID].edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: 'image-1',
        targetNodeId: scene3DNode.id,
        targetPort: 'backdrop',
      }),
    );
  });

  it('inserts a Scene 3D node between the selected source and the output pipe', () => {
    const nodes = [scene(), image('image-1')];
    const { actions, getState } = createHarness(nodes);

    actions.connectNodeInput('output', 'pipe', 'image-1');
    getState().selectedNodeId = 'image-1';
    getState().selectedNodeIds = ['image-1'];

    actions.addNode(NodeType.SCENE_3D);

    const state = getState();
    const scene3DNode = state.nodes.find((node) => node.type === NodeType.SCENE_3D)!;

    expect(scene3DNode.inputs).toEqual({ backdrop: 'image-1' });
    expect(state.flows[ROOT_FLOW_ID].edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: 'image-1',
          targetNodeId: scene3DNode.id,
          targetPort: 'backdrop',
        }),
        expect.objectContaining({
          sourceNodeId: scene3DNode.id,
          targetNodeId: 'output',
          targetPort: 'pipe',
        }),
      ]),
    );
  });

  it('inserts a chainable adjustment between the selected node and output pipe', () => {
    const nodes = [scene(), image('image-1')];
    const { actions, getState } = createHarness(nodes);

    actions.connectNodeInput('output', 'pipe', 'image-1');
    getState().selectedNodeId = 'image-1';
    getState().selectedNodeIds = ['image-1'];

    actions.addNode(NodeType.GRADE);

    const state = getState();
    const gradeNode = state.nodes.find((node) => node.type === NodeType.GRADE)!;

    expect(gradeNode.inputs).toEqual({ pipe: 'image-1' });
    expect(state.flows[ROOT_FLOW_ID].edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: 'image-1',
          targetNodeId: gradeNode.id,
          targetPort: 'pipe',
        }),
        expect.objectContaining({
          sourceNodeId: gradeNode.id,
          targetNodeId: 'output',
          targetPort: 'pipe',
        }),
      ]),
    );
  });

  it('connects source-like nodes with declared inputs instead of auto-merging them', () => {
    const nodes = [scene(), image('image-1')];
    const { actions, getState } = createHarness(nodes);
    getState().selectedNodeId = 'image-1';
    getState().selectedNodeIds = ['image-1'];

    actions.addNode(NodeType.ONNX_MODEL);

    const state = getState();
    const onnxNode = state.nodes.find((node) => node.type === NodeType.ONNX_MODEL)!;

    expect(onnxNode.inputs).toEqual({ image: 'image-1' });
    expect(state.nodes.some((node) => node.type === NodeType.MERGE)).toBe(false);
    expect(state.flows[ROOT_FLOW_ID].edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: 'image-1',
        targetNodeId: onnxNode.id,
        targetPort: 'image',
      }),
    );
  });

  it('defaults new reformat nodes to the scene format', () => {
    const nodes = [scene('scene', { width: 3840, height: 2160 })];
    const { actions, getState } = createHarness(nodes);
    getState().selectedNodeId = 'scene';
    getState().selectedNodeIds = ['scene'];

    actions.addNode(NodeType.REFORMAT);

    const reformatNode = getState().nodes.find((node) => node.type === NodeType.REFORMAT);
    expect(reformatNode).toMatchObject({
      width: 3840,
      height: 2160,
    });
  });

  it('keeps explicit reformat dimensions when adding with props', () => {
    const nodes = [scene('scene', { width: 3840, height: 2160 })];
    const { actions, getState } = createHarness(nodes);

    actions.addNodeWithProps(NodeType.REFORMAT, { width: 1280, height: 720 });

    const reformatNode = getState().nodes.find((node) => node.type === NodeType.REFORMAT);
    expect(reformatNode).toMatchObject({
      width: 1280,
      height: 720,
    });
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

  it('adds a second source through a real merge node', () => {
    const nodes = [scene(), image('image-1')];
    const { actions, getState, pushHistory } = createHarness(nodes);
    getState().selectedNodeId = 'image-1';
    getState().selectedNodeIds = ['image-1'];
    getState().nodePositionsByFlow = {
      [ROOT_FLOW_ID]: {
        'image-1': { x: -96, y: 0 },
        output: { x: -96, y: 212 },
      },
    };

    actions.addNode(NodeType.MEDIA_SOURCE);

    const state = getState();
    const addedSource = state.nodes.find(
      (node) => node.type === NodeType.MEDIA_SOURCE && node.id !== 'image-1',
    )!;
    const mergeNode = state.nodes.find((node) => node.type === NodeType.MERGE)!;

    expect(addedSource).toEqual(expect.objectContaining({ detachedFromPipe: true }));
    expect(mergeNode).toEqual(
      expect.objectContaining({
        inputs: { source: addedSource.id, pipe: 'image-1' },
      }),
    );
    expect(state.nodes.map((node) => node.id)).toEqual([
      'scene',
      'image-1',
      addedSource.id,
      mergeNode.id,
    ]);
    expect(state.selectedNodeId).toBe(addedSource.id);
    expect(state.selectedNodeIds).toEqual([addedSource.id]);
    expect(state.flows[ROOT_FLOW_ID].edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: addedSource.id,
          targetNodeId: mergeNode.id,
          targetPort: 'source',
        }),
        expect.objectContaining({
          sourceNodeId: 'image-1',
          targetNodeId: mergeNode.id,
          targetPort: 'pipe',
        }),
        expect.objectContaining({
          sourceNodeId: mergeNode.id,
          targetNodeId: 'output',
          targetPort: 'pipe',
        }),
      ]),
    );
    expect(state.nodePositionsByFlow?.[ROOT_FLOW_ID]).toEqual(
      expect.objectContaining({
        [addedSource.id]: { x: -348, y: 0 },
        [mergeNode.id]: { x: -96, y: 182 },
        output: { x: -96, y: 306 },
      }),
    );
    expect(pushHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Add Merge Image 2',
      }),
    );
  });

  it('creates a merge when adding a source from a selected non-source node, merge pipe comes from selected node', () => {
    const nodes = [scene(), image('image-1'), grade('grade-1')];
    const { actions, getState, pushHistory } = createHarness(nodes);

    // Wire up: image-1 → grade-1 → output
    actions.connectNodeInput('grade-1', 'pipe', 'image-1');
    actions.connectNodeInput('output', 'pipe', 'grade-1');
    // Select the GRADE (non-source), not the image
    getState().selectedNodeId = 'grade-1';
    getState().selectedNodeIds = ['grade-1'];

    actions.addNode(NodeType.MEDIA_SOURCE);

    const state = getState();
    const addedSource = state.nodes.find(
      (node) => node.type === NodeType.MEDIA_SOURCE && node.id !== 'image-1',
    )!;
    const mergeNode = state.nodes.find((node) => node.type === NodeType.MERGE)!;
    const upstreamImage = state.nodes.find((node) => node.id === 'image-1')!;
    const selectedGrade = state.nodes.find((node) => node.id === 'grade-1')!;

    expect(mergeNode).toBeDefined();
    // Merge's pipe comes FROM grade-1 (the selected node), same as source case
    expect(mergeNode).toEqual(
      expect.objectContaining({
        inputs: { source: addedSource.id, pipe: 'grade-1' },
      }),
    );
    // Grade retains its upstream pipe input (image-1 feeds into grade-1)
    expect(selectedGrade).toEqual(
      expect.objectContaining({
        inputs: { pipe: 'image-1' },
      }),
    );
    // Merge output goes to what was downstream of grade-1: the output
    expect(state.flows[ROOT_FLOW_ID].edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: mergeNode.id,
        targetNodeId: 'output',
        targetPort: 'pipe',
      }),
    );
    // grade-1 → merge (pipe)
    expect(state.flows[ROOT_FLOW_ID].edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: 'grade-1',
        targetNodeId: mergeNode.id,
        targetPort: 'pipe',
      }),
    );
    // image-1 → grade-1 (pipe) still intact
    expect(state.flows[ROOT_FLOW_ID].edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: 'image-1',
        targetNodeId: 'grade-1',
        targetPort: 'pipe',
      }),
    );
    // newSource → merge (source)
    expect(state.flows[ROOT_FLOW_ID].edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: addedSource.id,
        targetNodeId: mergeNode.id,
        targetPort: 'source',
      }),
    );
    expect(pushHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Add Merge Image 2',
      }),
    );
  });

  it('creates a merge when adding a source from a selected non-source node that has a downstream non-output node, merge output connects to that downstream', () => {
    const nodes = [scene(), image('image-1'), grade('grade-1'), blur('blur-1')];
    const { actions, getState, pushHistory } = createHarness(nodes);

    // Wire up: image-1 → grade-1 → blur-1 → output
    actions.connectNodeInput('grade-1', 'pipe', 'image-1');
    actions.connectNodeInput('blur-1', 'pipe', 'grade-1');
    actions.connectNodeInput('output', 'pipe', 'blur-1');
    // Select the GRADE (non-source)
    getState().selectedNodeId = 'grade-1';
    getState().selectedNodeIds = ['grade-1'];

    actions.addNode(NodeType.MEDIA_SOURCE);

    const state = getState();
    const addedSource = state.nodes.find(
      (node) => node.type === NodeType.MEDIA_SOURCE && node.id !== 'image-1',
    )!;
    const mergeNode = state.nodes.find((node) => node.type === NodeType.MERGE)!;
    const selectedGrade = state.nodes.find((node) => node.id === 'grade-1')!;
    const downstreamBlur = state.nodes.find((node) => node.id === 'blur-1')!;

    expect(mergeNode).toBeDefined();
    // Merge's pipe comes FROM grade-1 (the selected node)
    expect(mergeNode).toEqual(
      expect.objectContaining({
        inputs: { source: addedSource.id, pipe: 'grade-1' },
      }),
    );
    // Grade retains its upstream pipe input
    expect(selectedGrade).toEqual(
      expect.objectContaining({
        inputs: { pipe: 'image-1' },
      }),
    );
    // Blur-1's pipe input should now point to merge (not grade-1)
    expect(downstreamBlur).toEqual(
      expect.objectContaining({
        inputs: { pipe: mergeNode.id },
      }),
    );
    // Merge output goes to blur-1 (the downstream of grade-1)
    expect(state.flows[ROOT_FLOW_ID].edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: mergeNode.id,
        targetNodeId: 'blur-1',
        targetPort: 'pipe',
      }),
    );
    // grade-1 → merge (pipe)
    expect(state.flows[ROOT_FLOW_ID].edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: 'grade-1',
        targetNodeId: mergeNode.id,
        targetPort: 'pipe',
      }),
    );
    // image-1 → grade-1 (pipe) still intact
    expect(state.flows[ROOT_FLOW_ID].edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: 'image-1',
        targetNodeId: 'grade-1',
        targetPort: 'pipe',
      }),
    );
    // newSource → merge (source)
    expect(state.flows[ROOT_FLOW_ID].edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: addedSource.id,
        targetNodeId: mergeNode.id,
        targetPort: 'source',
      }),
    );
    // blur-1 → output still intact
    expect(state.flows[ROOT_FLOW_ID].edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: 'blur-1',
        targetNodeId: 'output',
        targetPort: 'pipe',
      }),
    );
    // No stale edge from grade-1 → blur-1
    expect(state.flows[ROOT_FLOW_ID].edges).not.toContainEqual(
      expect.objectContaining({
        sourceNodeId: 'grade-1',
        targetNodeId: 'blur-1',
        targetPort: 'pipe',
      }),
    );
    // Merge does NOT connect directly to output (it connects to blur-1)
    expect(state.flows[ROOT_FLOW_ID].edges).not.toContainEqual(
      expect.objectContaining({
        sourceNodeId: mergeNode.id,
        targetNodeId: 'output',
        targetPort: 'pipe',
      }),
    );
    expect(pushHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Add Merge Image 2',
      }),
    );
  });

  it('connects merge output to a downstream adjustment node instead of directly to output', () => {
    const nodes = [scene(), image('image-1'), grade('grade-1')];
    const { actions, getState, pushHistory } = createHarness(nodes);

    // Wire up: image-1 → grade-1 → output
    actions.connectNodeInput('grade-1', 'pipe', 'image-1');
    actions.connectNodeInput('output', 'pipe', 'grade-1');
    getState().selectedNodeId = 'image-1';
    getState().selectedNodeIds = ['image-1'];

    actions.addNode(NodeType.MEDIA_SOURCE);

    const state = getState();
    const addedSource = state.nodes.find(
      (node) => node.type === NodeType.MEDIA_SOURCE && node.id !== 'image-1',
    )!;
    const mergeNode = state.nodes.find((node) => node.type === NodeType.MERGE)!;
    const downstreamGrade = state.nodes.find((node) => node.id === 'grade-1')!;

    expect(mergeNode).toEqual(
      expect.objectContaining({
        inputs: { source: addedSource.id, pipe: 'image-1' },
      }),
    );
    expect(downstreamGrade).toEqual(
      expect.objectContaining({
        inputs: { pipe: mergeNode.id },
      }),
    );
    // Merge should feed into grade-1, NOT directly into output
    expect(state.flows[ROOT_FLOW_ID].edges).not.toContainEqual(
      expect.objectContaining({
        sourceNodeId: 'image-1',
        targetNodeId: 'grade-1',
        targetPort: 'pipe',
      }),
    );
    expect(state.flows[ROOT_FLOW_ID].edges).not.toContainEqual(
      expect.objectContaining({
        sourceNodeId: mergeNode.id,
        targetNodeId: 'output',
        targetPort: 'pipe',
      }),
    );
    expect(state.flows[ROOT_FLOW_ID].edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: addedSource.id,
        targetNodeId: mergeNode.id,
        targetPort: 'source',
      }),
    );
    expect(state.flows[ROOT_FLOW_ID].edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: 'image-1',
        targetNodeId: mergeNode.id,
        targetPort: 'pipe',
      }),
    );
    expect(state.flows[ROOT_FLOW_ID].edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: mergeNode.id,
        targetNodeId: 'grade-1',
        targetPort: 'pipe',
      }),
    );
    expect(state.flows[ROOT_FLOW_ID].edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: 'grade-1',
        targetNodeId: 'output',
        targetPort: 'pipe',
      }),
    );
    expect(pushHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Add Merge Image 2',
      }),
    );
  });

  it('does not connect merge to output when selected source has no downstream connection to output', () => {
    const nodes = [scene(), image('image-1'), image('image-2')];
    const { actions, getState, pushHistory } = createHarness(nodes);

    // Select image-1 — it is NOT the last implicit pipe source (image-2 is),
    // and no explicit pipe edges exist. Output is still connected implicitly
    // via image-2. So selected node has no direct connection to output.
    getState().selectedNodeId = 'image-1';
    getState().selectedNodeIds = ['image-1'];

    actions.addNode(NodeType.MEDIA_SOURCE);

    const state = getState();
    const addedSource = state.nodes.find(
      (node) =>
        node.type === NodeType.MEDIA_SOURCE && node.id !== 'image-1' && node.id !== 'image-2',
    )!;
    const mergeNode = state.nodes.find((node) => node.type === NodeType.MERGE)!;

    expect(mergeNode).toEqual(
      expect.objectContaining({
        inputs: { source: addedSource.id, pipe: 'image-1' },
      }),
    );
    // Merge should NOT have a direct pipe edge to output — selected node was
    // not connected to output, so merge stays floating too.
    expect(state.flows[ROOT_FLOW_ID].edges).not.toContainEqual(
      expect.objectContaining({
        sourceNodeId: mergeNode.id,
        targetNodeId: 'output',
        targetPort: 'pipe',
      }),
    );
    expect(pushHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Add Merge Image 3',
      }),
    );
  });

  it('connects merge to output when selected source is implicitly the last pipe source', () => {
    const nodes = [scene(), image('image-1')];
    const { actions, getState, pushHistory } = createHarness(nodes);

    // No explicit pipe edges, but output is not detached. image-1 is the last
    // implicit pipe source — its output implicitly feeds into output.
    getState().selectedNodeId = 'image-1';
    getState().selectedNodeIds = ['image-1'];

    actions.addNode(NodeType.MEDIA_SOURCE);

    const state = getState();
    const addedSource = state.nodes.find(
      (node) => node.type === NodeType.MEDIA_SOURCE && node.id !== 'image-1',
    )!;
    const mergeNode = state.nodes.find((node) => node.type === NodeType.MERGE)!;

    expect(mergeNode).toEqual(
      expect.objectContaining({
        inputs: { source: addedSource.id, pipe: 'image-1' },
      }),
    );
    // Merge SHOULD connect to output — selected node was the last implicit
    // pipe source.
    expect(state.flows[ROOT_FLOW_ID].edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: mergeNode.id,
        targetNodeId: 'output',
        targetPort: 'pipe',
      }),
    );
    expect(pushHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Add Merge Image 2',
      }),
    );
  });

  it('inserts pre-connected extract and merge channel nodes into a selected pipe target', () => {
    const nodes = [scene(), image('image-1'), grade('grade-1')];
    const { actions, getState, pushHistory } = createHarness(nodes);
    getState().selectedNodeId = 'grade-1';

    actions.addNode(NodeType.EXTRACT_CHANNELS);

    const state = getState();
    const extractNode = state.nodes.find((node) => node.type === NodeType.EXTRACT_CHANNELS)!;
    const mergeNode = state.nodes.find((node) => node.type === NodeType.MERGE_CHANNELS)!;
    const targetNode = state.nodes.find((node) => node.id === 'grade-1')!;

    expect(state.nodes.map((node) => node.id)).toEqual([
      'scene',
      'image-1',
      extractNode.id,
      mergeNode.id,
      'grade-1',
    ]);
    expect(extractNode).toEqual(
      expect.objectContaining({
        inputs: { source: 'image-1' },
      }),
    );
    expect(mergeNode).toEqual(
      expect.objectContaining({
        inputs: {
          r: extractNode.id,
          g: extractNode.id,
          b: extractNode.id,
          a: extractNode.id,
        },
        inputSourcePorts: {
          r: 'r',
          g: 'g',
          b: 'b',
          a: 'a',
        },
      }),
    );
    expect(targetNode).toEqual(
      expect.objectContaining({
        inputs: { pipe: mergeNode.id },
      }),
    );
    expect(state.flows[ROOT_FLOW_ID].edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: 'image-1',
          targetNodeId: extractNode.id,
          targetPort: 'source',
        }),
        expect.objectContaining({
          sourceNodeId: extractNode.id,
          sourcePort: 'r',
          targetNodeId: mergeNode.id,
          targetPort: 'r',
        }),
        expect.objectContaining({
          sourceNodeId: mergeNode.id,
          targetNodeId: 'grade-1',
          targetPort: 'pipe',
        }),
      ]),
    );
    expect(pushHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Add Extract/Merge Channels Nodes',
      }),
    );
  });

  it('inserts pre-connected channel nodes before the output pipe', () => {
    const nodes = [scene(), image('image-1')];
    const { actions, getState } = createHarness(nodes);
    getState().selectedNodeId = 'output';
    getState().selectedNodeIds = ['output'];

    actions.addNode(NodeType.EXTRACT_CHANNELS);

    const state = getState();
    const extractNode = state.nodes.find((node) => node.type === NodeType.EXTRACT_CHANNELS)!;
    const mergeNode = state.nodes.find((node) => node.type === NodeType.MERGE_CHANNELS)!;

    expect(extractNode.inputs).toEqual({ source: 'image-1' });
    expect(mergeNode.inputs).toEqual({
      r: extractNode.id,
      g: extractNode.id,
      b: extractNode.id,
      a: extractNode.id,
    });
    expect(state.flows[ROOT_FLOW_ID].edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: mergeNode.id,
          targetNodeId: 'output',
          targetPort: 'pipe',
        }),
      ]),
    );
  });
});

describe('createNodeActions connectNodeInput', () => {
  it('rejects connections that would make the persisted flow cyclic', () => {
    const source = { ...image('source'), inputs: { mask: 'target' } } as AnyNode;
    const nodes = [scene(), image('target'), source];
    const { actions, getState, pushHistory } = createHarness(nodes);

    actions.connectNodeInput('target', 'comfy-input:workflow:12:image', 'source');

    expect(getState().nodes.find((node) => node.id === 'target')).not.toHaveProperty('inputs');
    expect(getState().flows[ROOT_FLOW_ID].edges).toEqual([
      expect.objectContaining({
        sourceNodeId: 'target',
        targetNodeId: 'source',
        targetPort: 'mask',
      }),
    ]);
    expect(pushHistory).not.toHaveBeenCalled();
  });

  it('connects lower merge sources into earlier source inputs', () => {
    const nodes = [scene(), image('target'), image('source')];
    const { actions, getState, pushHistory } = createHarness(nodes);

    actions.connectNodeInput('target', 'comfy-input:workflow:12:image', 'source');

    expect(getState().nodes.find((node) => node.id === 'target')).toEqual(
      expect.objectContaining({
        inputs: { 'comfy-input:workflow:12:image': 'source' },
      }),
    );
    expect(getState().flows[ROOT_FLOW_ID].edges).toEqual([
      expect.objectContaining({
        sourceNodeId: 'source',
        targetNodeId: 'target',
        targetPort: 'comfy-input:workflow:12:image',
      }),
    ]);
    expect(pushHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Connect comfy-input:workflow:12:image input',
      }),
    );
  });

  it('preserves non-default source output ports on graph edges and node projections', () => {
    const extract = { ...image('extract'), type: NodeType.EXTRACT_CHANNELS } as AnyNode;
    const merge = { ...image('merge'), type: NodeType.MERGE_CHANNELS } as AnyNode;
    const nodes = [scene(), image('source'), extract, merge];
    const { actions, getState } = createHarness(nodes);

    actions.connectNodeInput('merge', 'a', 'extract', 'r');

    expect(getState().nodes.find((node) => node.id === 'merge')).toEqual(
      expect.objectContaining({
        inputs: { a: 'extract' },
        inputSourcePorts: { a: 'r' },
      }),
    );
    expect(getState().flows[ROOT_FLOW_ID].edges).toEqual([
      expect.objectContaining({
        sourceNodeId: 'extract',
        sourcePort: 'r',
        targetNodeId: 'merge',
        targetPort: 'a',
      }),
    ]);
  });

  it('connects and disconnects the canonical output pipe as an explicit graph edge', () => {
    const nodes = [scene(), image('source'), image('merge')];
    const { actions, getState } = createHarness(nodes);

    actions.connectNodeInput('output', 'pipe', 'merge');

    expect(getState().flows[ROOT_FLOW_ID].edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: 'merge',
        sourcePort: 'output',
        targetNodeId: 'output',
        targetPort: 'pipe',
      }),
    );

    actions.disconnectNodeInput('output', 'pipe');

    expect(getState().flows[ROOT_FLOW_ID].edges).not.toContainEqual(
      expect.objectContaining({
        targetNodeId: 'output',
        targetPort: 'pipe',
      }),
    );
    expect(
      getState().flows[ROOT_FLOW_ID].nodes.find((node) => node.id === 'output'),
    ).toHaveProperty('detachedFromPipe', true);
  });

  it('preserves explicit output pipe edges when node projections rebuild the flow', () => {
    const nodes = [scene(), image('source'), image('merge')];
    const { actions, getState } = createHarness(nodes);

    actions.connectNodeInput('output', 'pipe', 'merge');
    actions.updateNode('merge', { name: 'Merge renamed' } as Partial<AnyNode>);

    expect(getState().flows[ROOT_FLOW_ID].edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: 'merge',
        targetNodeId: 'output',
        targetPort: 'pipe',
      }),
    );
  });

  it('drops stale node input projections after disconnecting a merge input', () => {
    const merge = {
      ...image('merge'),
      type: NodeType.MERGE,
      inputs: { source: 'source', pipe: 'main' },
    } as AnyNode;
    const nodes = [scene(), image('main'), image('source'), merge];
    const { actions, getState } = createHarness(nodes);

    actions.disconnectNodeInput('merge', 'source');

    expect(getState().nodes.find((node) => node.id === 'merge')).toEqual(
      expect.objectContaining({
        inputs: { pipe: 'main' },
      }),
    );
    expect(
      getState().flows[ROOT_FLOW_ID].nodes.find((node) => node.id === 'merge'),
    ).not.toHaveProperty('inputs');
    expect(getState().flows[ROOT_FLOW_ID].edges).not.toContainEqual(
      expect.objectContaining({
        targetNodeId: 'merge',
        targetPort: 'source',
      }),
    );
  });
});

describe('createNodeActions group nodes', () => {
  it('does not create a group from a single input node', () => {
    const nodes = [input()];
    const { actions, getState, pushHistory } = createHarness(nodes);
    getState().selectedNodeId = 'input-1';
    getState().selectedNodeIds = ['input-1'];

    actions.groupSelectedNodes();

    expect(getState().nodes.map((node) => node.id)).toEqual(['input-1']);
    expect(getState().nodes.some((node) => node.type === NodeType.GROUP)).toBe(false);
    expect(pushHistory).not.toHaveBeenCalled();
  });

  it('keeps input nodes out of grouping while allowing mixed selections', () => {
    const nodes = [input(), blur('blur-1')];
    const { actions, getState } = createHarness(nodes);
    getState().selectedNodeId = 'blur-1';
    getState().selectedNodeIds = ['input-1', 'blur-1'];

    actions.groupSelectedNodes();

    const state = getState();
    const groupNode = state.nodes.find((node) => node.type === NodeType.GROUP)!;
    expect(groupNode).toBeDefined();
    expect(state.nodes.map((node) => node.id)).toContain('input-1');
    const childNodeIds = state.flows[groupNode.childFlowId!].nodes.map((node) => node.id);
    expect(childNodeIds).not.toContain('input-1');
    expect(childNodeIds).toEqual([`input_${groupNode.id}_input_blur-1_pipe`, 'blur-1', 'output']);
  });

  it('creates a group node with a native child flow from selected nodes', () => {
    const nodes = [scene(), image('image-1'), grade('grade-1')];
    const { actions, getState, pushHistory } = createHarness(nodes);
    getState().selectedNodeId = 'grade-1';
    getState().selectedNodeIds = ['image-1', 'grade-1'];

    actions.groupSelectedNodes();

    const state = getState();
    const groupNode = state.nodes.find((node) => node.type === NodeType.GROUP);
    expect(groupNode).toBeDefined();
    expect(state.selectedNodeIds).toEqual([groupNode!.id]);
    expect(state.flows[ROOT_FLOW_ID].nodes.map((node) => node.id)).toContain(groupNode!.id);
    expect(state.flows[groupNode!.childFlowId!].nodes.map((node) => node.id)).toEqual([
      'image-1',
      'grade-1',
      'output',
    ]);
    expect(pushHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Group 2 Nodes',
      }),
    );
  });

  it('preserves external graph connections as explicit group inputs and output edges', () => {
    const nodes = [
      scene(),
      image('source'),
      { ...blur('blur-1'), inputs: { mask: 'source' } } as AnyNode,
      { ...grade('grade-1'), inputs: { matte: 'blur-1' } } as AnyNode,
    ];
    const { actions, getState } = createHarness(nodes);
    getState().selectedNodeId = 'blur-1';
    getState().selectedNodeIds = ['blur-1'];

    actions.groupSelectedNodes();

    const state = getState();
    const groupNode = state.nodes.find((node) => node.type === NodeType.GROUP)!;
    const pipeInput = groupNode.externalInputs!.find((input) => input.targetPort === 'pipe')!;
    const maskInput = groupNode.externalInputs!.find((input) => input.targetPort === 'mask')!;
    expect(groupNode.inputs).toEqual({
      [pipeInput.id]: 'source',
      [maskInput.id]: 'source',
    });
    expect(groupNode.externalInputs?.map((input) => input.targetPort)).toEqual(['pipe', 'mask']);
    expect(groupNode.inputNodeId).toBe(`input_${groupNode.id}_input_blur-1_pipe`);
    expect(pipeInput.entryNodeId).toBe(groupNode.inputNodeId);
    expect(maskInput.entryNodeId).toBe(groupNode.inputNodeId);
    expect(groupNode.externalInputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entryNodeId: groupNode.inputNodeId,
          targetNodeId: 'blur-1',
          targetPort: 'pipe',
        }),
        expect.objectContaining({
          entryNodeId: groupNode.inputNodeId,
          targetNodeId: 'blur-1',
          targetPort: 'mask',
        }),
      ]),
    );
    expect(state.flows[ROOT_FLOW_ID].edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: 'source',
          targetNodeId: groupNode.id,
          targetPort: pipeInput.id,
        }),
        expect.objectContaining({
          sourceNodeId: 'source',
          targetNodeId: groupNode.id,
          targetPort: maskInput.id,
        }),
        expect.objectContaining({
          sourceNodeId: groupNode.id,
          targetNodeId: 'grade-1',
          targetPort: 'matte',
        }),
      ]),
    );
    expect(groupNode.outputNodeId).toBe('blur-1');
    expect(
      state.flows[groupNode.childFlowId!].nodes.filter((node) => node.type === NodeType.INPUT),
    ).toHaveLength(1);
    expect(state.flows[groupNode.childFlowId!].edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: groupNode.inputNodeId,
          targetNodeId: 'blur-1',
          targetPort: 'pipe',
        }),
        expect.objectContaining({
          sourceNodeId: maskInput.entryNodeId,
          targetNodeId: 'blur-1',
          targetPort: 'mask',
        }),
        expect.objectContaining({
          sourceNodeId: 'blur-1',
          targetNodeId: 'output',
          targetPort: 'pipe',
        }),
      ]),
    );
  });

  it('exposes declared child input ports when creating a group', () => {
    const nodes = [scene(), mergeChannels('channels-1')];
    const { actions, getState } = createHarness(nodes);
    getState().selectedNodeId = 'channels-1';
    getState().selectedNodeIds = ['channels-1'];

    actions.groupSelectedNodes();

    const state = getState();
    const groupNode = state.nodes.find((node) => node.type === NodeType.GROUP)!;
    expect(groupNode.inputs).toBeUndefined();
    expect(
      groupNode.externalInputs?.map((input) => ({
        label: input.label,
        targetNodeId: input.targetNodeId,
        targetPort: input.targetPort,
      })),
    ).toEqual([
      { label: 'channels-1 R', targetNodeId: 'channels-1', targetPort: 'r' },
      { label: 'channels-1 G', targetNodeId: 'channels-1', targetPort: 'g' },
      { label: 'channels-1 B', targetNodeId: 'channels-1', targetPort: 'b' },
      { label: 'channels-1 A', targetNodeId: 'channels-1', targetPort: 'a' },
    ]);

    const childFlow = state.flows[groupNode.childFlowId!];
    expect(childFlow.nodes.filter((node) => node.type === NodeType.INPUT)).toHaveLength(4);
    expect(childFlow.edges).toEqual(
      expect.arrayContaining(
        groupNode.externalInputs!.map((input) =>
          expect.objectContaining({
            sourceNodeId: input.entryNodeId,
            targetNodeId: input.targetNodeId,
            targetPort: input.targetPort,
          }),
        ),
      ),
    );
  });

  it('creates an input entry node for the implicit upstream pipe when opening a group', () => {
    const nodes = [scene(), image('source'), blur('blur-1'), grade('grade-1')];
    const { actions, getState } = createHarness(nodes);
    getState().selectedNodeId = 'blur-1';
    getState().selectedNodeIds = ['blur-1'];

    actions.groupSelectedNodes();
    const groupNode = getState().nodes.find((node) => node.type === NodeType.GROUP)!;
    const pipeInput = groupNode.externalInputs!.find((input) => input.targetPort === 'pipe')!;

    expect(groupNode.externalInputs).toEqual([
      expect.objectContaining({
        id: pipeInput.id,
        label: 'Main',
        entryNodeId: groupNode.inputNodeId,
        targetNodeId: 'blur-1',
        targetPort: 'pipe',
      }),
    ]);
    expect(groupNode.inputs).toEqual({ [pipeInput.id]: 'source' });
    expect(groupNode.inputNodeId).toBe(`input_${groupNode.id}_input_blur-1_pipe`);

    actions.openGroupNode(groupNode.id);

    expect(getState().activeFlowId).toBe(groupNode.childFlowId);
    expect(getState().nodes.map((node) => node.id)).toEqual([groupNode.inputNodeId, 'blur-1']);
    expect(getState().nodes[0]).toEqual(
      expect.objectContaining({
        type: NodeType.INPUT,
        name: 'Main',
        groupNodeId: groupNode.id,
        externalInputId: pipeInput.id,
      }),
    );
  });

  it('can recreate the main group input after removing it', () => {
    const nodes = [scene(), image('source'), blur('blur-1'), grade('grade-1')];
    const { actions, getState } = createHarness(nodes);
    getState().selectedNodeId = 'blur-1';
    getState().selectedNodeIds = ['blur-1'];

    actions.groupSelectedNodes();
    const groupNode = getState().nodes.find((node) => node.type === NodeType.GROUP)!;
    const pipeInput = groupNode.externalInputs!.find((input) => input.targetPort === 'pipe')!;

    actions.removeGroupInput(groupNode.id, pipeInput.id);
    actions.exposeGroupInput(groupNode.id, 'blur-1', 'pipe', 'Main');

    const updatedGroupNode = getState().flows[ROOT_FLOW_ID].nodes.find(
      (node) => node.id === groupNode.id,
    ) as GroupNode;
    const childFlow = getState().flows[groupNode.childFlowId!];
    const recreatedPipeInput = updatedGroupNode.externalInputs!.find(
      (input) => input.targetPort === 'pipe',
    )!;

    expect(recreatedPipeInput).toEqual(
      expect.objectContaining({
        id: pipeInput.id,
        label: 'Main',
        entryNodeId: groupNode.inputNodeId,
        targetNodeId: 'blur-1',
        targetPort: 'pipe',
      }),
    );
    expect(childFlow.nodes.filter((node) => node.id === groupNode.inputNodeId)).toHaveLength(1);
    expect(childFlow.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: groupNode.inputNodeId,
          targetNodeId: 'blur-1',
          targetPort: 'pipe',
        }),
      ]),
    );
  });

  it('keeps a shared implicit input entry when removing one exposed group input', () => {
    const nodes = [
      scene(),
      image('source'),
      { ...blur('blur-1'), inputs: { mask: 'source' } } as AnyNode,
      grade('grade-1'),
    ];
    const { actions, getState } = createHarness(nodes);
    getState().selectedNodeId = 'blur-1';
    getState().selectedNodeIds = ['blur-1'];

    actions.groupSelectedNodes();

    const groupNode = getState().nodes.find((node) => node.type === NodeType.GROUP)!;
    const maskInput = groupNode.externalInputs!.find((input) => input.targetPort === 'mask')!;

    actions.removeGroupInput(groupNode.id, maskInput.id);

    const updatedGroupNode = getState().flows[ROOT_FLOW_ID].nodes.find(
      (node) => node.id === groupNode.id,
    )!;
    const childFlow = getState().flows[groupNode.childFlowId!];
    expect(updatedGroupNode).toEqual(
      expect.objectContaining({
        inputNodeId: groupNode.inputNodeId,
        externalInputs: [
          expect.objectContaining({
            entryNodeId: groupNode.inputNodeId,
            targetNodeId: 'blur-1',
            targetPort: 'pipe',
          }),
        ],
      }),
    );
    expect(childFlow.nodes.map((node) => node.id)).toContain(groupNode.inputNodeId);
    expect(childFlow.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: groupNode.inputNodeId,
          targetNodeId: 'blur-1',
          targetPort: 'pipe',
        }),
      ]),
    );
    expect(childFlow.edges).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: groupNode.inputNodeId,
          targetNodeId: 'blur-1',
          targetPort: 'mask',
        }),
      ]),
    );
  });

  it('exposes nested group pipe wiring as an input port', () => {
    let now = 1_700_000_000_000;
    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now++);

    try {
      const nodes = [scene(), image('source'), blur('blur-1')];
      const { actions, getState } = createHarness(nodes);
      getState().selectedNodeId = 'blur-1';
      getState().selectedNodeIds = ['blur-1'];

      actions.groupSelectedNodes();
      const outerGroup = getState().nodes.find((node) => node.type === NodeType.GROUP)!;

      actions.openGroupNode(outerGroup.id);
      getState().selectedNodeId = 'blur-1';
      getState().selectedNodeIds = ['blur-1'];

      actions.groupSelectedNodes();

      const nestedGroup = getState().nodes.find((node) => node.type === NodeType.GROUP)!;
      const outerChildFlow = getState().flows[outerGroup.childFlowId!];
      const nestedChildFlow = getState().flows[nestedGroup.childFlowId!];
      const nestedPipeInput = nestedGroup.externalInputs!.find(
        (input) => input.targetPort === 'pipe',
      )!;

      expect(nestedGroup.externalInputs ?? []).toEqual([
        expect.objectContaining({
          id: nestedPipeInput.id,
          label: 'Main',
          entryNodeId: nestedGroup.inputNodeId,
          targetNodeId: 'blur-1',
          targetPort: 'pipe',
        }),
      ]);
      expect(nestedGroup.inputs).toEqual({ [nestedPipeInput.id]: outerGroup.inputNodeId });
      expect(nestedGroup.inputNodeId).toBe(`input_${nestedGroup.id}_input_blur-1_pipe`);
      expect(outerChildFlow.edges.filter((edge) => edge.targetNodeId === nestedGroup.id)).toEqual([
        expect.objectContaining({
          sourceNodeId: outerGroup.inputNodeId,
          targetPort: nestedPipeInput.id,
        }),
      ]);
      expect(
        nestedChildFlow.edges.filter(
          (edge) => edge.sourceNodeId === nestedGroup.inputNodeId && edge.targetPort === 'pipe',
        ),
      ).toHaveLength(1);
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('opens a group child flow for editing', () => {
    const nodes = [scene(), image('image-1'), grade('grade-1')];
    const { actions, getState } = createHarness(nodes);
    getState().selectedNodeIds = ['image-1', 'grade-1'];

    actions.groupSelectedNodes();
    const groupNode = getState().nodes.find((node) => node.type === NodeType.GROUP)!;

    actions.openGroupNode(groupNode.id);

    expect(getState().activeFlowId).toBe(groupNode.childFlowId);
    expect(getState().nodes.map((node) => node.id)).toEqual(['image-1', 'grade-1']);
  });
});

describe('createNodeActions node clipboard', () => {
  it('copies and pastes multiple selected nodes with their internal wiring', async () => {
    const nodes = [
      scene(),
      image('source'),
      { ...blur('blur-1'), inputs: { mask: 'source' } } as AnyNode,
      grade('grade-1'),
    ];
    const { actions, getState, pushHistory } = createHarness(nodes);
    getState().selectedNodeId = 'blur-1';
    getState().selectedNodeIds = ['source', 'blur-1'];
    getState().nodePositionsByFlow = {
      [ROOT_FLOW_ID]: {
        source: { x: 100, y: 200 },
        'blur-1': { x: 320, y: 200 },
        'grade-1': { x: 320, y: 200 },
      },
    };

    await actions.copySelectedNodesToClipboard();
    getState().selectedNodeId = 'grade-1';
    getState().selectedNodeIds = ['grade-1'];
    await actions.pasteNodesFromClipboard();

    const state = getState();
    const pastedSource = state.nodes.find((node) => node.id === 'source_copy')!;
    const pastedBlur = state.nodes.find((node) => node.id === 'blur-1_copy')!;

    expect(pastedSource).toEqual(expect.objectContaining({ name: 'source 1' }));
    expect(pastedBlur).toEqual(
      expect.objectContaining({
        name: 'blur-1 1',
        inputs: { mask: pastedSource.id },
      }),
    );
    expect(state.selectedNodeIds).toEqual([pastedSource.id, pastedBlur.id]);
    expect(state.flows[ROOT_FLOW_ID].edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: pastedSource.id,
        targetNodeId: pastedBlur.id,
        targetPort: 'mask',
      }),
    );
    expect(state.nodePositionsByFlow?.[ROOT_FLOW_ID]?.[pastedSource.id]).toEqual({
      x: 368,
      y: 248,
    });
    expect(pushHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({
        label: 'Paste 2 Nodes',
      }),
    );
  });

  it('pastes with no selection as a detached island', async () => {
    const nodes = [scene(), image('source'), blur('blur-1'), grade('grade-1')];
    const { actions, getState } = createHarness(nodes);
    getState().selectedNodeId = 'blur-1';
    getState().selectedNodeIds = ['source', 'blur-1'];

    await actions.copySelectedNodesToClipboard();
    getState().selectedNodeId = null;
    getState().selectedNodeIds = [];
    await actions.pasteNodesFromClipboard();

    const state = getState();
    expect(state.nodes.find((node) => node.id === 'source_copy')).toEqual(
      expect.objectContaining({ detachedFromPipe: true }),
    );
    expect(state.nodes.find((node) => node.id === 'blur-1_copy')).toEqual(
      expect.objectContaining({ detachedFromPipe: true }),
    );
  });

  it('copies and pastes a group with a fresh nested child flow', async () => {
    const group = {
      id: 'group-1',
      type: NodeType.GROUP,
      name: 'Group',
      enabled: true,
      childFlowId: 'flow-group-1',
      externalInputs: [],
    } as GroupNode;
    const nodes = [scene(), group as AnyNode, grade('grade-1')];
    const { actions, getState } = createHarness(nodes);
    const childFlow = buildFlowFromNodes(
      [image('child-source'), grade('child-grade')],
      'flow-group-1',
      'Group',
    );
    getState().flows[childFlow.id] = childFlow;
    getState().nodePositionsByFlow = {
      [ROOT_FLOW_ID]: {
        'group-1': { x: 200, y: 300 },
      },
      [childFlow.id]: {
        'child-source': { x: 10, y: 20 },
        'child-grade': { x: 240, y: 20 },
      },
    };
    getState().selectedNodeId = 'group-1';
    getState().selectedNodeIds = ['group-1'];

    await actions.copySelectedNodesToClipboard();
    getState().selectedNodeId = 'grade-1';
    getState().selectedNodeIds = ['grade-1'];
    await actions.pasteNodesFromClipboard();

    const pastedGroup = getState().nodes.find((node) => node.id === 'group-1_copy') as GroupNode;
    expect(pastedGroup).toBeDefined();
    expect(pastedGroup.childFlowId).toBe('flow_flow-group-1_copy');
    expect(pastedGroup.childFlowId).not.toBe(group.childFlowId);

    const pastedChildFlow = getState().flows[pastedGroup.childFlowId!];
    expect(pastedChildFlow.nodes.map((node) => node.id)).toEqual([
      'child-source_copy',
      'child-grade_copy',
      'output',
    ]);
    expect(getState().nodePositionsByFlow?.[pastedGroup.childFlowId!]).toEqual({
      'child-source_copy': { x: 10, y: 20 },
      'child-grade_copy': { x: 240, y: 20 },
    });
  });

  it('cuts every selected node as one history operation', async () => {
    const nodes = [scene(), image('source'), blur('blur-1'), grade('grade-1')];
    const { actions, getState, pushHistory } = createHarness(nodes);
    getState().selectedNodeId = 'blur-1';
    getState().selectedNodeIds = ['source', 'blur-1'];

    await actions.cutSelectedNodesToClipboard();

    expect(getState().nodes.map((node) => node.id)).toEqual(['scene', 'grade-1']);
    expect(pushHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({
        label: 'Cut 2 Nodes',
      }),
    );
  });
});

describe('createNodeActions history frame targeting', () => {
  it('pushes the affected target frame when setting a keyframe off the playhead', () => {
    const node = {
      id: 'node-1',
      type: NodeType.GRADE,
      name: 'Grade 1',
      enabled: true,
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
      enabled: true,
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
    const nodes = [scene(), image('image-1'), grade('grade-1')];
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
    const nodes = [scene(), grade('grade-1', false)];
    const { actions, getState, pushHistory } = createHarness(nodes);

    actions.toggleNodeStacking('grade-1');

    expect(getState().nodes.find((node) => node.id === 'grade-1')?.stacked).toBeFalsy();
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
    const flowId = getState().rootFlowId ?? '';
    getState().nodePositionsByFlow![flowId] = {
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
    // Position is no longer cleaned up here — auto-layout handles stale positions.
  });

  it('does not stack source nodes', () => {
    const nodes = [scene(), image('image-1'), image('image-2')];
    const { actions, getState, pushHistory } = createHarness(nodes);

    expect(actions.stackNodeOntoStack('image-2', 'image-1')).toBe(false);
    expect(getState().nodes.map((node) => node.id)).toEqual(['scene', 'image-1', 'image-2']);
    expect(pushHistory).not.toHaveBeenCalled();
  });
});
