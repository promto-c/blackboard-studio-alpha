import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BlendMode,
  ComfyNode,
  ImageFitMode,
  ImageNode,
  NodeType,
  PaintNode,
  RotoDrawMode,
  RotoNode,
  RotoPathBlend,
  RotoShapeType,
  SceneNode,
} from '@blackboard/types';
import { getInitialHistoryEntry, getInitialState } from '@/state/editor/initialState';
import {
  buildFlowFromNodes,
  getOrderedNodesFromFlow,
  ROOT_FLOW_ID,
} from '@/state/editor/flowModel';
import { createProjectActions } from '@/state/editor/slices/projectActions';
import { loadProjectState, saveProject } from '@/state/persist';
import { requestReferencePermissions } from '@/state/assetStorage';

const sourcePixelDataMocks = vi.hoisted(() => ({
  onReadFrame: undefined as undefined | ((frame: number) => void),
  calculateOpticalFlow: undefined as
    | undefined
    | ((points: Array<{ x: number; y: number }>) => Array<{ x: number; y: number; error: number }>),
}));

vi.mock('@/state/persist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/state/persist')>();
  return {
    ...actual,
    saveProject: vi.fn(),
    loadProjectState: vi.fn(),
    saveProjectIndex: vi.fn(),
    getProjectIndex: vi.fn(() => []),
    deleteProject: vi.fn(),
  };
});

vi.mock('@/state/assetStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/state/assetStorage')>();
  return {
    ...actual,
    saveAsset: vi.fn(),
    deleteAssets: vi.fn(),
    requestReferencePermissions: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/state/editor/services/sourcePixelData', () => ({
  resolveSourcePixelSource: vi.fn(() => ({ kind: 'media-node', node: { id: 'image-1' } })),
  createSourcePixelDataReader: vi.fn(() => ({
    getFramePixelData: vi.fn(async (frame: number) => {
      sourcePixelDataMocks.onReadFrame?.(frame);
      return {
        data: new Uint8ClampedArray(20 * 20 * 4),
        width: 20,
        height: 20,
      };
    }),
    dispose: vi.fn(),
  })),
}));

vi.mock('@/utils/opticalFlow', () => ({
  applySolvedTransform: vi.fn(
    (points: Array<{ x: number; y: number }>, transform: { dx?: number; dy?: number } | null) =>
      points.map((point) => ({
        x: point.x + (transform?.dx ?? 0),
        y: point.y + (transform?.dy ?? 0),
      })),
  ),
  buildOpticalFlowPyramid: vi.fn(() => ({})),
  calculateOpticalFlowFromPyramids: vi.fn(
    (_previous: unknown, _current: unknown, points: Array<{ x: number; y: number }>) =>
      sourcePixelDataMocks.calculateOpticalFlow?.(points) ??
      points.map((point) => ({ ...point, x: point.x + 1, y: point.y + 1, error: 1 })),
  ),
  fitTrackedTransform: vi.fn(() => null),
  solveTransform: vi.fn(
    (
      _source: Array<{ x: number; y: number }>,
      _target: Array<{ x: number; y: number }>,
      points: Array<{ x: number; y: number }>,
    ) => points.map((point) => ({ x: point.x + 1, y: point.y + 1 })),
  ),
}));

type TestState = ReturnType<typeof getInitialState> & { maxFrames: number };

const createHarness = (
  options: {
    initialState?: Partial<TestState>;
    deps?: Partial<Parameters<typeof createProjectActions>[2]>;
  } = {},
) => {
  let state: TestState = {
    ...getInitialState(),
    maxFrames: 0,
    ...options.initialState,
  };

  const set = (fn: (prevState: TestState) => Partial<TestState> | TestState) => {
    state = { ...state, ...fn(state) };
  };
  const get = () => state;

  const actions = createProjectActions(set as never, get as never, {
    pushHistory: vi.fn(),
    debouncedSave: vi.fn(),
    trackingAbortController: { current: null },
    ...options.deps,
  });

  return {
    actions,
    getState: () => state,
    setState: (patch: Partial<TestState>) => {
      state = { ...state, ...patch };
    },
  };
};

describe('createProjectActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sourcePixelDataMocks.onReadFrame = undefined;
    sourcePixelDataMocks.calculateOpticalFlow = undefined;
    vi.mocked(requestReferencePermissions).mockResolvedValue(undefined);
  });

  it('restores the selected node default viewport tool when loading a project', async () => {
    const initialState = getInitialState();
    const sceneNode: SceneNode = {
      id: 'scene-1',
      type: NodeType.SCENE,
      name: 'Scene',
      visible: true,
      width: 1920,
      height: 1080,
      bitDepth: 16,
      colorSpace: 'Linear',
      maxFrames: 0,
      fps: 24,
    };
    const paintNode: PaintNode = {
      id: 'paint-1',
      type: NodeType.PAINT,
      name: 'Paint',
      visible: true,
      strokes: [],
    };
    const flow = buildFlowFromNodes([sceneNode, paintNode], ROOT_FLOW_ID, 'Root Flow');

    vi.mocked(loadProjectState).mockResolvedValue({
      flows: { [ROOT_FLOW_ID]: flow },
      rootFlowId: ROOT_FLOW_ID,
      activeFlowId: ROOT_FLOW_ID,
      activeTab: initialState.activeTab,
      selectedNodeId: paintNode.id,
      history: [getInitialHistoryEntry()],
      historyIndex: 0,
      viewerNodeId: null,
      viewerSlots: {},
      activeViewerSlot: null,
      renderSettings: initialState.renderSettings,
      viewerSettings: initialState.viewerSettings,
      fps: 24,
      nodePositionsByFlow: {},
    });

    const { actions, getState } = createHarness();

    await actions.loadProject('project-1');

    expect(getState().selectedNodeId).toBe(paintNode.id);
    expect(getState().activeViewportTool).toBe('brush');
  });

  it('restores the saved current frame when loading a project', async () => {
    const initialState = getInitialState();
    const sceneNode: SceneNode = {
      id: 'scene-1',
      type: NodeType.SCENE,
      name: 'Scene',
      visible: true,
      width: 1920,
      height: 1080,
      bitDepth: 16,
      colorSpace: 'Linear',
      maxFrames: 120,
      fps: 24,
    };
    const flow = buildFlowFromNodes([sceneNode], ROOT_FLOW_ID, 'Root Flow');

    vi.mocked(loadProjectState).mockResolvedValue({
      flows: { [ROOT_FLOW_ID]: flow },
      rootFlowId: ROOT_FLOW_ID,
      activeFlowId: ROOT_FLOW_ID,
      activeTab: initialState.activeTab,
      selectedNodeId: sceneNode.id,
      history: [getInitialHistoryEntry()],
      historyIndex: 0,
      viewerNodeId: null,
      viewerSlots: {},
      activeViewerSlot: null,
      renderSettings: initialState.renderSettings,
      viewerSettings: initialState.viewerSettings,
      fps: 24,
      currentFrame: 42,
      nodePositionsByFlow: {},
    });

    const { actions, getState } = createHarness();

    await actions.loadProject('project-1');

    expect(getState().currentFrame).toBe(42);
  });

  it('clamps the saved current frame to the loaded project duration', async () => {
    const initialState = getInitialState();
    const sceneNode: SceneNode = {
      id: 'scene-1',
      type: NodeType.SCENE,
      name: 'Scene',
      visible: true,
      width: 1920,
      height: 1080,
      bitDepth: 16,
      colorSpace: 'Linear',
      maxFrames: 12,
      fps: 24,
    };
    const flow = buildFlowFromNodes([sceneNode], ROOT_FLOW_ID, 'Root Flow');

    vi.mocked(loadProjectState).mockResolvedValue({
      flows: { [ROOT_FLOW_ID]: flow },
      rootFlowId: ROOT_FLOW_ID,
      activeFlowId: ROOT_FLOW_ID,
      activeTab: initialState.activeTab,
      selectedNodeId: sceneNode.id,
      history: [getInitialHistoryEntry()],
      historyIndex: 0,
      viewerNodeId: null,
      viewerSlots: {},
      activeViewerSlot: null,
      renderSettings: initialState.renderSettings,
      viewerSettings: initialState.viewerSettings,
      fps: 24,
      currentFrame: 99,
      nodePositionsByFlow: {},
    });

    const { actions, getState } = createHarness();

    await actions.loadProject('project-1');

    expect(getState().currentFrame).toBe(12);
  });

  it('applies a completed Comfy job to a saved project when another project is active', async () => {
    const initialState = getInitialState();
    const comfyNode: ComfyNode = {
      id: 'comfy-1',
      type: NodeType.COMFY,
      name: 'Comfy',
      visible: true,
      workflows: [],
      src: 'old-asset',
      width: 64,
      height: 64,
      opacity: 100,
      operator: BlendMode.OVER,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
      colorSpace: 'sRGB',
      generatedOutputs: [],
    };
    const flow = buildFlowFromNodes([comfyNode], ROOT_FLOW_ID, 'Root Flow');

    vi.mocked(loadProjectState).mockResolvedValue({
      flows: { [ROOT_FLOW_ID]: flow },
      rootFlowId: ROOT_FLOW_ID,
      activeFlowId: ROOT_FLOW_ID,
      activeTab: initialState.activeTab,
      selectedNodeId: comfyNode.id,
      history: [
        {
          id: 'hist-saved-start',
          label: 'Initial State',
          state: {
            flows: { [ROOT_FLOW_ID]: flow },
            rootFlowId: ROOT_FLOW_ID,
            activeFlowId: ROOT_FLOW_ID,
            selectedNodeId: comfyNode.id,
          },
        },
      ],
      historyIndex: 0,
      viewerNodeId: null,
      viewerSlots: {},
      activeViewerSlot: null,
      renderSettings: initialState.renderSettings,
      viewerSettings: initialState.viewerSettings,
      fps: 24,
      nodePositionsByFlow: {},
    });

    const { actions } = createHarness();

    const result = await actions.applyComfyNodeRunResult({
      projectId: 'project-1',
      nodeId: comfyNode.id,
      updates: {
        src: 'new-asset',
        width: 128,
        height: 96,
        generatedOutputs: [
          {
            id: 'output-1',
            src: 'new-asset',
            width: 128,
            height: 96,
            createdAt: 123,
          },
        ],
        activeGeneratedOutputId: 'output-1',
      },
      withHistory: true,
    });

    expect(result).toBe('saved');
    const savedState = vi.mocked(saveProject).mock.calls.at(-1)?.[1];
    const savedFlow = savedState?.flows?.[ROOT_FLOW_ID] ?? null;
    const savedComfyNode = getOrderedNodesFromFlow(savedFlow).find(
      (node) => node.id === comfyNode.id,
    ) as ComfyNode | undefined;

    expect(savedComfyNode).toMatchObject({
      src: 'new-asset',
      width: 128,
      height: 96,
      activeGeneratedOutputId: 'output-1',
    });
    expect(savedComfyNode?.generatedOutputs).toHaveLength(1);
    const initialHistoryNode = getOrderedNodesFromFlow(
      savedState?.history?.[0]?.state.flows?.[ROOT_FLOW_ID] ?? null,
    ).find((node) => node.id === comfyNode.id) as ComfyNode | undefined;
    expect(initialHistoryNode?.generatedOutputs).toHaveLength(1);
    expect(savedState?.historyIndex).toBe(1);
  });

  it('adds a completed Comfy output to gallery state without activating it when history moved', async () => {
    const comfyNode: ComfyNode = {
      id: 'comfy-1',
      type: NodeType.COMFY,
      name: 'Comfy',
      visible: true,
      workflows: [],
      src: 'old-asset',
      width: 64,
      height: 64,
      opacity: 100,
      operator: BlendMode.OVER,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
      colorSpace: 'sRGB',
      generatedOutputs: [],
    };
    const redoNode: ComfyNode = {
      ...comfyNode,
      src: 'redo-asset',
      width: 80,
      height: 80,
    };
    const pushHistory = vi.fn();
    const debouncedSave = vi.fn();
    const { actions, getState } = createHarness({
      initialState: {
        projectId: 'project-1',
        nodes: [comfyNode],
        history: [
          {
            id: 'hist-undone',
            label: 'Undone state',
            state: { nodes: [comfyNode], selectedNodeId: comfyNode.id },
          },
          {
            id: 'hist-run-start',
            label: 'Run start state',
            state: { nodes: [redoNode], selectedNodeId: comfyNode.id },
          },
        ],
        historyIndex: 0,
        selectedNodeId: comfyNode.id,
      },
      deps: { pushHistory, debouncedSave },
    });

    const result = await actions.applyComfyNodeRunResult({
      projectId: 'project-1',
      nodeId: comfyNode.id,
      updates: {
        src: 'new-asset',
        width: 128,
        height: 96,
        generatedOutputs: [
          {
            id: 'output-1',
            src: 'new-asset',
            width: 128,
            height: 96,
            createdAt: 123,
          },
        ],
        activeGeneratedOutputId: 'output-1',
      },
      withHistory: true,
      expectedHistoryId: 'hist-run-start',
    });

    const state = getState();
    const currentNode = state.nodes[0] as ComfyNode;

    expect(result).toBe('gallery');
    expect(pushHistory).not.toHaveBeenCalled();
    expect(debouncedSave).toHaveBeenCalled();
    expect(state.history).toHaveLength(2);
    expect(state.historyIndex).toBe(0);
    expect(currentNode.src).toBe('old-asset');
    expect(currentNode.activeGeneratedOutputId).toBeUndefined();
    expect(currentNode.generatedOutputs).toHaveLength(1);
    expect((state.history[0].state.nodes?.[0] as ComfyNode).generatedOutputs).toHaveLength(1);
    expect((state.history[1].state.nodes?.[0] as ComfyNode).generatedOutputs).toHaveLength(1);
  });

  it('does not stop roto tracking for a single outlier drift point', async () => {
    const sceneNode: SceneNode = {
      id: 'scene-1',
      type: NodeType.SCENE,
      name: 'Scene',
      visible: true,
      width: 20,
      height: 20,
      bitDepth: 16,
      colorSpace: 'Linear',
      maxFrames: 1,
      fps: 24,
    };
    const imageNode: ImageNode = {
      id: 'image-1',
      type: NodeType.IMAGE,
      name: 'Plate',
      visible: true,
      src: 'asset-1',
      width: 20,
      height: 20,
      opacity: 100,
      operator: BlendMode.OVER,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
      colorSpace: 'sRGB',
    };
    const rotoNode: RotoNode = {
      id: 'roto-1',
      type: NodeType.ROTO,
      name: 'Roto',
      visible: true,
      invert: false,
      paths: [
        {
          id: 'path-1',
          name: 'Shape',
          shapeType: RotoShapeType.POLYGON,
          points: [
            { x: -2, y: -2 },
            { x: 2, y: -2 },
            { x: -2, y: 2 },
          ],
          closed: true,
          feather: 0,
          opacity: 100,
          blend: RotoPathBlend.ADD,
          style: { mode: RotoDrawMode.FILL, strokeWidth: 1 },
        },
      ],
    };
    const flow = buildFlowFromNodes([sceneNode, imageNode, rotoNode], ROOT_FLOW_ID, 'Root Flow');
    const finishBackgroundJob = vi.fn();
    const { actions, getState } = createHarness({
      initialState: {
        projectId: 'project-1',
        activeProjectBranchId: 'main',
        nodes: [sceneNode, imageNode, rotoNode],
        flows: { [ROOT_FLOW_ID]: flow },
        rootFlowId: ROOT_FLOW_ID,
        activeFlowId: ROOT_FLOW_ID,
        selectedNodeId: rotoNode.id,
        currentFrame: 0,
        maxFrames: 1,
        fps: 24,
      },
      deps: {
        startBackgroundJob: vi.fn(() => 'job-1'),
        updateBackgroundJob: vi.fn(),
        finishBackgroundJob,
      },
    });

    sourcePixelDataMocks.calculateOpticalFlow = (points) =>
      points.map((point, index) => ({
        ...point,
        x: point.x + 1,
        y: point.y + 1,
        error: index === 2 ? 100 : 1,
      }));

    await actions.trackRotoSelection(
      rotoNode.id,
      ['path-1'],
      { kind: 'shape', pathId: 'path-1' },
      imageNode.id,
      'forward',
      1,
      {
        translation: true,
        rotation: false,
        scale: false,
        affine: false,
        perspective: false,
        deform: true,
        driftTolerance: 15,
      },
      { runInBackground: true },
    );

    const trackedNode = getState().nodes.find((node) => node.id === rotoNode.id) as
      | RotoNode
      | undefined;

    expect(finishBackgroundJob).toHaveBeenLastCalledWith(
      'job-1',
      expect.objectContaining({ status: 'complete' }),
    );
    expect(trackedNode?.paths[0]?.trackingData?.[1]).toBe(1);
  });

  it('applies completed background roto tracking to the source project when another project is active', async () => {
    const initialState = getInitialState();
    const sceneNode: SceneNode = {
      id: 'scene-1',
      type: NodeType.SCENE,
      name: 'Scene',
      visible: true,
      width: 20,
      height: 20,
      bitDepth: 16,
      colorSpace: 'Linear',
      maxFrames: 1,
      fps: 24,
    };
    const imageNode: ImageNode = {
      id: 'image-1',
      type: NodeType.IMAGE,
      name: 'Plate',
      visible: true,
      src: 'asset-1',
      width: 20,
      height: 20,
      opacity: 100,
      operator: BlendMode.OVER,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
      colorSpace: 'sRGB',
    };
    const rotoNode: RotoNode = {
      id: 'roto-1',
      type: NodeType.ROTO,
      name: 'Roto',
      visible: true,
      invert: false,
      paths: [
        {
          id: 'path-1',
          name: 'Shape',
          shapeType: RotoShapeType.POLYGON,
          points: [
            { x: -2, y: -2 },
            { x: 2, y: -2 },
            { x: -2, y: 2 },
          ],
          closed: true,
          feather: 0,
          opacity: 100,
          blend: RotoPathBlend.ADD,
          style: { mode: RotoDrawMode.FILL, strokeWidth: 1 },
        },
      ],
    };
    const projectFlow = buildFlowFromNodes(
      [sceneNode, imageNode, rotoNode],
      ROOT_FLOW_ID,
      'Root Flow',
    );
    const otherProjectFlow = buildFlowFromNodes([sceneNode], ROOT_FLOW_ID, 'Root Flow');

    vi.mocked(loadProjectState).mockResolvedValue({
      flows: { [ROOT_FLOW_ID]: projectFlow },
      rootFlowId: ROOT_FLOW_ID,
      activeFlowId: ROOT_FLOW_ID,
      activeTab: initialState.activeTab,
      selectedNodeId: rotoNode.id,
      history: [getInitialHistoryEntry()],
      historyIndex: 0,
      viewerNodeId: null,
      viewerSlots: {},
      activeViewerSlot: null,
      renderSettings: initialState.renderSettings,
      viewerSettings: initialState.viewerSettings,
      fps: 24,
      currentFrame: 0,
      nodePositionsByFlow: {},
    });

    const harness = createHarness({
      initialState: {
        projectId: 'project-1',
        activeProjectBranchId: 'main',
        nodes: [sceneNode, imageNode, rotoNode],
        flows: { [ROOT_FLOW_ID]: projectFlow },
        rootFlowId: ROOT_FLOW_ID,
        activeFlowId: ROOT_FLOW_ID,
        selectedNodeId: rotoNode.id,
        currentFrame: 0,
        maxFrames: 1,
        fps: 24,
      },
      deps: {
        startBackgroundJob: vi.fn(() => 'job-1'),
        updateBackgroundJob: vi.fn(),
        finishBackgroundJob: vi.fn(),
      },
    });

    sourcePixelDataMocks.onReadFrame = (frame) => {
      if (frame !== 1) return;
      harness.setState({
        projectId: 'project-2',
        activeProjectBranchId: 'main',
        nodes: [sceneNode],
        flows: { [ROOT_FLOW_ID]: otherProjectFlow },
        rootFlowId: ROOT_FLOW_ID,
        activeFlowId: ROOT_FLOW_ID,
        selectedNodeId: sceneNode.id,
      });
    };

    await harness.actions.trackRotoSelection(
      rotoNode.id,
      ['path-1'],
      { kind: 'shape', pathId: 'path-1' },
      imageNode.id,
      'forward',
      1,
      {
        translation: true,
        rotation: false,
        scale: false,
        affine: false,
        perspective: false,
        deform: true,
      },
      { runInBackground: true },
    );

    expect(harness.getState().projectId).toBe('project-2');
    expect(harness.getState().nodes).toHaveLength(1);

    const savedState = vi.mocked(saveProject).mock.calls.at(-1)?.[1];
    const savedFlow = savedState?.flows?.[ROOT_FLOW_ID] ?? null;
    const savedRotoNode = getOrderedNodesFromFlow(savedFlow).find(
      (node) => node.id === rotoNode.id,
    ) as RotoNode | undefined;
    const savedTrackX = savedRotoNode?.paths[0]?.trackPoints?.[0]?.x;

    expect(vi.mocked(saveProject).mock.calls.at(-1)?.[0]).toBe('project-1');
    expect(savedRotoNode?.paths[0]?.trackingData?.[1]).toBe(1);
    expect(Array.isArray(savedTrackX)).toBe(true);
    expect(
      Array.isArray(savedTrackX) ? savedTrackX.find((key) => key.frame === 1)?.value : null,
    ).toBe(1);
    expect(savedState?.historyIndex).toBe(1);
  });
});
