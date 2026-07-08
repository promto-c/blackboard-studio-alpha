import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BlendMode,
  ComfyNode,
  HistoryEntry,
  ImageFitMode,
  GroupNode,
  MediaSourceNode,
  NodeType,
  PaintNode,
  RotoDrawMode,
  RotoNode,
  RotoPathBlend,
  RotoShapeType,
  SceneNode,
} from '@blackboard/types';
import { getInitialState } from '@/state/editor/initialState';
import {
  buildFlowFromNodes,
  getOrderedNodesFromFlow,
  ROOT_FLOW_ID,
} from '@/state/editor/flowModel';
import { createProjectActions } from '@/state/editor/slices/projectActions';
import {
  createBuiltinProjectColorConfigReference,
  createDefaultProjectColorManagement,
} from '@/color-management';
import {
  deleteProject as deleteProjectFromStorage,
  getProjectBranchStorageId,
  getProjectBranches,
  loadProjectState,
  saveProject,
  upsertProjectBranch,
} from '@/state/persist';
import { deleteAssets, requestReferencePermissions } from '@/state/assetStorage';
import type { CommitEditorMutation } from '@/state/editor/commitMutation';

const sourcePixelDataMocks = vi.hoisted(() => ({
  onReadFrame: undefined as undefined | ((frame: number) => void),
  calculateOpticalFlow: undefined as
    | undefined
    | ((points: Array<{ x: number; y: number }>) => Array<{ x: number; y: number; error: number }>),
}));

const galleryMocks = vi.hoisted(() => ({
  addGalleryEntries: vi.fn(async () => undefined),
  createEntryId: vi.fn(() => 'gallery-entry'),
  loadGalleryEntries: vi.fn(async () => []),
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

vi.mock('@blackboard/project-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@blackboard/project-store')>();
  return {
    ...actual,
    addGalleryEntries: galleryMocks.addGalleryEntries,
    createEntryId: galleryMocks.createEntryId,
    loadGalleryEntries: galleryMocks.loadGalleryEntries,
    makeProjectTag: (projectId: string) => `project:${projectId}`,
    makeNodeTag: (nodeId: string) => `node:${nodeId}`,
    makeWorkflowTag: (workflowId: string) => `workflow:${workflowId}`,
    makeBranchTag: (branchId: string) => `branch:${branchId}`,
    makeSourceTag: (source: 'Comfy') => `source:${source.toLowerCase()}`,
    hasTag: (tags: string[], tag: string) => tags.includes(tag),
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
  calculateHybridOpticalFlowFromPyramids: vi.fn(
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
  const commitMutation: CommitEditorMutation<TestState> = (input) => {
    const mutation = typeof input === 'function' ? input(state) : input;
    state = { ...state, ...mutation.patch };

    if (!mutation.history) return;

    const nextEntry: HistoryEntry = {
      id: `hist_test_${state.history.length}`,
      label: mutation.history.label,
      state: mutation.history.state as HistoryEntry['state'],
      createdAt: Date.now(),
    };
    const nextHistory = [...state.history.slice(0, state.historyIndex + 1), nextEntry];
    state = {
      ...state,
      history: nextHistory,
      historyIndex: nextHistory.length - 1,
    };
  };

  const actions = createProjectActions(set as never, get as never, {
    commitMutation,
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
    vi.unstubAllGlobals();
    galleryMocks.createEntryId.mockImplementation(
      () => `gallery-entry-${galleryMocks.createEntryId.mock.calls.length + 1}`,
    );
    galleryMocks.loadGalleryEntries.mockResolvedValue([]);
    sourcePixelDataMocks.onReadFrame = undefined;
    sourcePixelDataMocks.calculateOpticalFlow = undefined;
    vi.mocked(requestReferencePermissions).mockResolvedValue(undefined);
  });

  it('copies the selected color config into new dimension projects', () => {
    const selectedColorManagement = createDefaultProjectColorManagement({
      config: createBuiltinProjectColorConfigReference('ocio://show-config-v1'),
    });
    const { actions, getState } = createHarness({
      deps: {
        getNewProjectColorManagement: () => selectedColorManagement,
      },
    });

    actions.createNewProjectFromDimensions('Show Project', 1280, 720);

    const expectedConfig = {
      kind: 'builtin',
      id: 'show-config-v1',
      uri: 'ocio://show-config-v1',
    };
    const state = getState();
    expect(state.colorManagement.config).toEqual(expectedConfig);
    expect(state.history[0]?.state.colorManagement?.config).toEqual(expectedConfig);
    expect(saveProject).toHaveBeenCalled();
    const savedState = vi.mocked(saveProject).mock.calls.at(-1)?.[1];
    expect(savedState?.colorManagement.config).toEqual(expectedConfig);
  });

  it('restores the selected node default viewport tool when loading a project', async () => {
    const initialState = getInitialState();
    const sceneNode: SceneNode = {
      id: 'scene-1',
      type: NodeType.SCENE,
      name: 'Scene',
      enabled: true,
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
      enabled: true,
      strokes: [],
    };
    const flow = buildFlowFromNodes([sceneNode, paintNode], ROOT_FLOW_ID, 'Root Flow');

    vi.mocked(loadProjectState).mockResolvedValue({
      flows: { [ROOT_FLOW_ID]: flow },
      rootFlowId: ROOT_FLOW_ID,
      activeFlowId: ROOT_FLOW_ID,
      activeTab: initialState.activeTab,
      colorManagement: initialState.colorManagement,
      selectedNodeId: paintNode.id,
      viewerNodeId: null,
      viewerSlots: {},
      activeViewerSlot: null,
      renderSettings: initialState.renderSettings,
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
      enabled: true,
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
      colorManagement: initialState.colorManagement,
      selectedNodeId: sceneNode.id,
      viewerNodeId: null,
      viewerSlots: {},
      activeViewerSlot: null,
      renderSettings: initialState.renderSettings,
      fps: 24,
      currentFrame: 42,
      nodePositionsByFlow: {},
    });

    const { actions, getState } = createHarness();

    await actions.loadProject('project-1');

    expect(getState().currentFrame).toBe(42);
  });

  it('restores persisted history when loading a project', async () => {
    const initialState = getInitialState();
    const sceneNode: SceneNode = {
      id: 'scene-1',
      type: NodeType.SCENE,
      name: 'Scene',
      enabled: true,
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
      colorManagement: initialState.colorManagement,
      selectedNodeId: sceneNode.id,
      history: [
        {
          id: 'checkpoint-1',
          label: 'Blocked comp',
          checkpointLabel: 'Blocked comp',
          state: {
            flows: { [ROOT_FLOW_ID]: flow },
            rootFlowId: ROOT_FLOW_ID,
            activeFlowId: ROOT_FLOW_ID,
            selectedNodeId: sceneNode.id,
          },
        },
      ],
      historyIndex: 0,
      viewerNodeId: null,
      viewerSlots: {},
      activeViewerSlot: null,
      renderSettings: initialState.renderSettings,
      fps: 24,
      currentFrame: 42,
      nodePositionsByFlow: {},
    });

    const { actions, getState } = createHarness();

    await actions.loadProject('project-1');

    expect(getState().history.map((entry) => entry.id)).toEqual(['checkpoint-1']);
    expect(getState().history[0]?.checkpointLabel).toBe('Blocked comp');
    expect(getState().historyIndex).toBe(0);
  });

  it('restores history with correct index across multiple entries', async () => {
    const initialState = getInitialState();
    const sceneNode: SceneNode = {
      id: 'scene-1',
      type: NodeType.SCENE,
      name: 'Scene',
      enabled: true,
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
      colorManagement: initialState.colorManagement,
      selectedNodeId: sceneNode.id,
      history: [
        {
          id: 'hist-older',
          label: 'Older edit',
          checkpointLabel: 'Older edit',
          createdAt: 100,
          state: {
            flows: { [ROOT_FLOW_ID]: flow },
            rootFlowId: ROOT_FLOW_ID,
            activeFlowId: ROOT_FLOW_ID,
            selectedNodeId: sceneNode.id,
          },
        },
        {
          id: 'hist-previous',
          label: 'Previous edit',
          createdAt: 200,
          state: {
            flows: { [ROOT_FLOW_ID]: flow },
            rootFlowId: ROOT_FLOW_ID,
            activeFlowId: ROOT_FLOW_ID,
            selectedNodeId: sceneNode.id,
          },
        },
        {
          id: 'hist-recent',
          label: 'Recent grade',
          createdAt: 300,
          state: {
            flows: { [ROOT_FLOW_ID]: flow },
            rootFlowId: ROOT_FLOW_ID,
            activeFlowId: ROOT_FLOW_ID,
            selectedNodeId: sceneNode.id,
          },
        },
      ],
      historyIndex: 2,
      viewerNodeId: null,
      viewerSlots: {},
      activeViewerSlot: null,
      renderSettings: initialState.renderSettings,
      fps: 24,
      currentFrame: 42,
      nodePositionsByFlow: {},
    });

    const { actions, getState } = createHarness();

    await actions.loadProject('project-1');

    expect(getState().history.map((entry) => entry.id)).toEqual([
      'hist-older',
      'hist-previous',
      'hist-recent',
    ]);
    expect(getState().historyIndex).toBe(2);
  });

  it('restores redo history above the active undone entry when reopening a project', async () => {
    const initialState = getInitialState();
    const sceneNode: SceneNode = {
      id: 'scene-1',
      type: NodeType.SCENE,
      name: 'Scene',
      enabled: true,
      width: 1920,
      height: 1080,
      bitDepth: 16,
      colorSpace: 'Linear',
      maxFrames: 120,
      fps: 24,
    };
    const flow = buildFlowFromNodes([sceneNode], ROOT_FLOW_ID, 'Root Flow');
    const entryState = {
      flows: { [ROOT_FLOW_ID]: flow },
      rootFlowId: ROOT_FLOW_ID,
      activeFlowId: ROOT_FLOW_ID,
      selectedNodeId: sceneNode.id,
    };

    vi.mocked(loadProjectState).mockResolvedValue({
      flows: { [ROOT_FLOW_ID]: flow },
      rootFlowId: ROOT_FLOW_ID,
      activeFlowId: ROOT_FLOW_ID,
      activeTab: initialState.activeTab,
      colorManagement: initialState.colorManagement,
      selectedNodeId: sceneNode.id,
      history: [
        { id: 'edit-1', label: 'Edit 1', createdAt: 100, state: entryState },
        { id: 'edit-2', label: 'Edit 2', createdAt: 200, state: entryState },
        { id: 'edit-3', label: 'Edit 3', createdAt: 300, state: entryState },
      ],
      historyIndex: 0,
      viewerNodeId: null,
      viewerSlots: {},
      activeViewerSlot: null,
      renderSettings: initialState.renderSettings,
      fps: 24,
      currentFrame: 42,
      nodePositionsByFlow: {},
    });

    const { actions, getState } = createHarness();

    await actions.loadProject('project-1');

    expect(getState().history.map((entry) => entry.id)).toEqual(['edit-1', 'edit-2', 'edit-3']);
    expect(getState().historyIndex).toBe(0);
  });

  it('opens an older version in a new recovery branch without changing the source branch', async () => {
    const projectId = 'project-open-recovery-version';
    const initialState = getInitialState();
    const sceneNode: SceneNode = {
      id: 'scene-recovery',
      type: NodeType.SCENE,
      name: 'Scene',
      enabled: true,
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
      colorManagement: initialState.colorManagement,
      selectedNodeId: sceneNode.id,
      history: [
        {
          id: 'working-version',
          label: 'Working version',
          createdAt: 100,
          state: { currentFrame: 12 },
        },
        {
          id: 'failed-version',
          label: 'Failed version',
          createdAt: 200,
          state: { currentFrame: 48 },
        },
      ],
      historyIndex: 1,
      viewerNodeId: null,
      viewerSlots: {},
      activeViewerSlot: null,
      renderSettings: initialState.renderSettings,
      fps: 24,
      currentFrame: 48,
      nodePositionsByFlow: {},
    });

    const { actions, getState } = createHarness();
    await actions.loadProject(projectId, {
      branchId: 'main',
      historyEntryId: 'working-version',
      createRecoveryBranch: true,
    });

    const recoveryBranch = getState().projectBranches.find((branch) =>
      branch.name.startsWith('recovery/'),
    );
    expect(recoveryBranch).toMatchObject({
      parentBranchId: 'main',
      kind: 'user',
      status: 'active',
    });
    expect(getState().activeProjectBranchId).toBe(recoveryBranch?.id);
    expect(getState().currentFrame).toBe(12);
    expect(getState().history.map((entry) => entry.id)).toEqual(['working-version']);
    expect(saveProject).toHaveBeenCalledWith(
      getProjectBranchStorageId(projectId, recoveryBranch?.id),
      expect.objectContaining({
        currentFrame: 12,
        historyIndex: 0,
      }),
    );
  });

  it('deletes an inactive project branch and its stored snapshot', async () => {
    const projectId = 'project-delete-inactive-branch';
    const branch = {
      id: 'branch-delete-inactive',
      projectId,
      name: 'Delete Me',
      kind: 'user' as const,
      status: 'active' as const,
      createdAt: 1,
      updatedAt: 2,
    };
    const branchIndex = upsertProjectBranch(projectId, branch, 'main');
    const { actions, getState } = createHarness({
      initialState: {
        projectId,
        activeProjectBranchId: 'main',
        projectBranches: branchIndex.branches,
      },
    });

    await actions.deleteProjectBranch(branch.id);

    expect(getState().projectBranches.map((entry) => entry.id)).not.toContain(branch.id);
    expect(getProjectBranches(projectId).map((entry) => entry.id)).not.toContain(branch.id);
    expect(deleteProjectFromStorage).toHaveBeenCalledWith(
      getProjectBranchStorageId(projectId, branch.id),
    );
  });

  it('switches to main before deleting the active project branch', async () => {
    const initialState = getInitialState();
    const projectId = 'project-delete-active-branch';
    const sceneNode: SceneNode = {
      id: 'scene-1',
      type: NodeType.SCENE,
      name: 'Scene',
      enabled: true,
      width: 1920,
      height: 1080,
      bitDepth: 16,
      colorSpace: 'Linear',
      maxFrames: 12,
      fps: 24,
    };
    const flow = buildFlowFromNodes([sceneNode], ROOT_FLOW_ID, 'Root Flow');
    const branch = {
      id: 'branch-delete-active',
      projectId,
      name: 'Active Delete Me',
      kind: 'user' as const,
      parentBranchId: 'main',
      status: 'active' as const,
      createdAt: 1,
      updatedAt: 2,
    };
    const branchIndex = upsertProjectBranch(projectId, branch, branch.id);

    vi.mocked(loadProjectState).mockResolvedValue({
      flows: { [ROOT_FLOW_ID]: flow },
      rootFlowId: ROOT_FLOW_ID,
      activeFlowId: ROOT_FLOW_ID,
      activeTab: initialState.activeTab,
      colorManagement: initialState.colorManagement,
      selectedNodeId: sceneNode.id,
      viewerNodeId: null,
      viewerSlots: {},
      activeViewerSlot: null,
      renderSettings: initialState.renderSettings,
      fps: 24,
      currentFrame: 3,
      nodePositionsByFlow: {},
    });

    const { actions, getState } = createHarness({
      initialState: {
        projectId,
        activeProjectBranchId: branch.id,
        projectBranches: branchIndex.branches,
      },
    });

    await actions.deleteProjectBranch(branch.id);

    expect(getState().activeProjectBranchId).toBe('main');
    expect(getState().projectBranches.map((entry) => entry.id)).not.toContain(branch.id);
    expect(loadProjectState).toHaveBeenCalledWith(getProjectBranchStorageId(projectId, 'main'));
    expect(deleteProjectFromStorage).toHaveBeenCalledWith(
      getProjectBranchStorageId(projectId, branch.id),
    );
  });

  it('applies an agent branch snapshot to its parent branch', async () => {
    const initialState = getInitialState();
    const projectId = 'project-apply-agent-branch';
    const mainScene: SceneNode = {
      id: 'scene-main',
      type: NodeType.SCENE,
      name: 'Main Scene',
      enabled: true,
      width: 1920,
      height: 1080,
      bitDepth: 16,
      colorSpace: 'Linear',
      maxFrames: 12,
      fps: 24,
    };
    const agentScene: SceneNode = {
      ...mainScene,
      id: 'scene-agent',
      name: 'Agent Scene',
    };
    const mainFlow = buildFlowFromNodes([mainScene], ROOT_FLOW_ID, 'Root Flow');
    const agentFlow = buildFlowFromNodes([agentScene], ROOT_FLOW_ID, 'Root Flow');
    const branch = {
      id: 'agent-branch-apply',
      projectId,
      name: 'agent/apply-test',
      kind: 'agent' as const,
      parentBranchId: 'main',
      createdByAgentRunId: 'agent-run-1',
      status: 'active' as const,
      createdAt: 1,
      updatedAt: 2,
    };
    const branchIndex = upsertProjectBranch(projectId, branch, branch.id);
    const mainState = {
      flows: { [ROOT_FLOW_ID]: mainFlow },
      rootFlowId: ROOT_FLOW_ID,
      activeFlowId: ROOT_FLOW_ID,
      activeTab: initialState.activeTab,
      colorManagement: initialState.colorManagement,
      selectedNodeId: mainScene.id,
      viewerNodeId: null,
      viewerSlots: {},
      activeViewerSlot: null,
      renderSettings: initialState.renderSettings,
      fps: 24,
      currentFrame: 1,
      nodePositionsByFlow: {},
    };
    const agentState = {
      ...mainState,
      flows: { [ROOT_FLOW_ID]: agentFlow },
      selectedNodeId: agentScene.id,
      currentFrame: 5,
    };

    vi.mocked(loadProjectState).mockImplementation(async (storageId: string) =>
      storageId === getProjectBranchStorageId(projectId, branch.id) ? agentState : mainState,
    );

    const { actions, getState } = createHarness({
      initialState: {
        projectId,
        activeProjectBranchId: branch.id,
        projectBranches: branchIndex.branches,
      },
    });

    await actions.applyProjectBranchToParent(branch.id);

    expect(saveProject).toHaveBeenCalledWith(
      getProjectBranchStorageId(projectId, 'main'),
      expect.objectContaining(agentState),
    );
    expect(getState().activeProjectBranchId).toBe('main');
    expect(getState().selectedNodeId).toBe(agentScene.id);
    expect(getProjectBranches(projectId).find((entry) => entry.id === branch.id)?.status).toBe(
      'merged',
    );
  });

  it('clamps the saved current frame to the loaded project duration', async () => {
    const initialState = getInitialState();
    const sceneNode: SceneNode = {
      id: 'scene-1',
      type: NodeType.SCENE,
      name: 'Scene',
      enabled: true,
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
      colorManagement: initialState.colorManagement,
      selectedNodeId: sceneNode.id,
      viewerNodeId: null,
      viewerSlots: {},
      activeViewerSlot: null,
      renderSettings: initialState.renderSettings,
      fps: 24,
      currentFrame: 99,
      nodePositionsByFlow: {},
    });

    const { actions, getState } = createHarness();

    await actions.loadProject('project-1');

    expect(getState().currentFrame).toBe(12);
  });

  it('hydrates the active group flow and its positions when loading a project', async () => {
    const initialState = getInitialState();
    const sceneNode: SceneNode = {
      id: 'scene-1',
      type: NodeType.SCENE,
      name: 'Scene',
      enabled: true,
      width: 1920,
      height: 1080,
      bitDepth: 16,
      colorSpace: 'Linear',
      maxFrames: 120,
      fps: 24,
    };
    const groupNode: GroupNode = {
      id: 'group-1',
      type: NodeType.GROUP,
      name: 'Group',
      enabled: true,
      childFlowId: 'flow-group-1',
    };
    const paintNode: PaintNode = {
      id: 'paint-1',
      type: NodeType.PAINT,
      name: 'Paint',
      enabled: true,
      strokes: [],
    };
    const rootFlow = buildFlowFromNodes([sceneNode, groupNode], ROOT_FLOW_ID, 'Root Flow');
    const childFlow = buildFlowFromNodes([paintNode], 'flow-group-1', 'Group');
    const childPositions = { [paintNode.id]: { x: 320, y: 180 } };

    vi.mocked(loadProjectState).mockResolvedValue({
      flows: { [ROOT_FLOW_ID]: rootFlow, [childFlow.id]: childFlow },
      rootFlowId: ROOT_FLOW_ID,
      activeFlowId: childFlow.id,
      activeTab: initialState.activeTab,
      colorManagement: initialState.colorManagement,
      selectedNodeId: paintNode.id,
      viewerNodeId: null,
      viewerSlots: {},
      activeViewerSlot: null,
      renderSettings: initialState.renderSettings,
      fps: 24,
      nodePositionsByFlow: {
        [ROOT_FLOW_ID]: { [groupNode.id]: { x: 64, y: 80 } },
        [childFlow.id]: childPositions,
      },
    });

    const { actions, getState } = createHarness();

    await actions.loadProject('project-1');

    expect(getState().activeFlowId).toBe(childFlow.id);
    expect(getState().nodes.map((node) => node.id)).toEqual([paintNode.id]);
    expect(getState().nodePositionsByFlow?.[childFlow.id]).toEqual(childPositions);
    expect(getState().activeViewportTool).toBe('brush');
  });

  it('applies a completed Comfy job to a saved project when another project is active', async () => {
    const initialState = getInitialState();
    const comfyNode: ComfyNode = {
      id: 'comfy-1',
      type: NodeType.COMFY,
      name: 'Comfy',
      enabled: true,
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
      colorManagement: initialState.colorManagement,
      selectedNodeId: comfyNode.id,
      viewerNodeId: null,
      viewerSlots: {},
      activeViewerSlot: null,
      renderSettings: initialState.renderSettings,
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
        activeGeneratedOutputId: 'output-1',
      },
      newGeneratedOutputs: [
        {
          id: 'output-1',
          src: 'new-asset',
          width: 128,
          height: 96,
          createdAt: 123,
        },
      ],
      withHistory: true,
      expectedHistoryId: 'hist-run-start',
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
  });

  it('adds Comfy outputs to the app gallery when the original branch is no longer active', async () => {
    vi.stubGlobal('indexedDB', {});

    const initialState = getInitialState();
    const comfyNode: ComfyNode = {
      id: 'comfy-1',
      type: NodeType.COMFY,
      name: 'Comfy Scene Node',
      enabled: true,
      workflows: [],
      selectedWorkflowId: 'workflow-1',
      src: '',
      width: 0,
      height: 0,
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
      colorManagement: initialState.colorManagement,
      selectedNodeId: comfyNode.id,
      viewerNodeId: null,
      viewerSlots: {},
      activeViewerSlot: null,
      renderSettings: initialState.renderSettings,
      fps: 24,
      nodePositionsByFlow: {},
    });

    const { actions, getState } = createHarness({
      initialState: {
        projectId: 'project-1',
        activeProjectBranchId: 'other-branch',
      },
    });

    const result = await actions.applyComfyNodeRunResult({
      projectId: 'project-1',
      branchId: 'main',
      nodeId: comfyNode.id,
      updates: {
        src: 'new-asset',
        width: 128,
        height: 96,
        activeGeneratedOutputId: 'output-1',
      },
      newGeneratedOutputs: [
        {
          id: 'output-1',
          src: 'new-asset',
          width: 128,
          height: 96,
          createdAt: 123,
          promptId: 'prompt-1',
        },
      ],
    });

    expect(result).toBe('saved');
    expect(galleryMocks.addGalleryEntries).toHaveBeenCalledTimes(1);
    const galleryEntries =
      (
        galleryMocks.addGalleryEntries.mock.calls as unknown as Array<
          [Array<Record<string, unknown>>]
        >
      )[0]?.[0] ?? [];
    expect(galleryEntries).toHaveLength(1);
    expect(galleryEntries[0]).toMatchObject({
      assetId: 'new-asset',
      outputId: 'output-1',
      promptId: 'prompt-1',
      nodeName: 'Comfy Scene Node',
    });
    expect(galleryEntries[0]?.tags).toEqual(
      expect.arrayContaining([
        'project:project-1',
        'node:comfy-1',
        'branch:main',
        'source:comfy',
        'workflow:workflow-1',
        'output:output-1',
      ]),
    );
    expect(getState().galleryUpdatedAt).toBeGreaterThan(0);
  });

  it('adds only newly generated Comfy outputs to the app gallery', async () => {
    vi.stubGlobal('indexedDB', {});

    const existingOutput = {
      id: 'output-old',
      src: 'old-asset',
      width: 64,
      height: 64,
      createdAt: 100,
      promptId: 'prompt-old',
    };
    const newOutput = {
      id: 'output-new',
      src: 'new-asset',
      width: 128,
      height: 96,
      createdAt: 200,
      promptId: 'prompt-new',
    };
    const comfyNode: ComfyNode = {
      id: 'comfy-1',
      type: NodeType.COMFY,
      name: 'Comfy',
      enabled: true,
      workflows: [],
      selectedWorkflowId: 'workflow-1',
      src: existingOutput.src,
      width: existingOutput.width,
      height: existingOutput.height,
      opacity: 100,
      operator: BlendMode.OVER,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
      colorSpace: 'sRGB',
      generatedOutputs: [existingOutput],
    };
    const flow = buildFlowFromNodes([comfyNode], ROOT_FLOW_ID, 'Root Flow');
    const { actions, getState } = createHarness({
      initialState: {
        projectId: 'project-1',
        activeProjectBranchId: 'main',
        flows: { [ROOT_FLOW_ID]: flow },
        rootFlowId: ROOT_FLOW_ID,
        activeFlowId: ROOT_FLOW_ID,
        nodes: [comfyNode],
        selectedNodeId: comfyNode.id,
      },
    });

    const result = await actions.applyComfyNodeRunResult({
      projectId: 'project-1',
      nodeId: comfyNode.id,
      updates: {
        src: newOutput.src,
        width: newOutput.width,
        height: newOutput.height,
        activeGeneratedOutputId: newOutput.id,
      },
      newGeneratedOutputs: [newOutput],
    });

    expect(result).toBe('current');
    expect((getState().nodes[0] as ComfyNode).generatedOutputs).toHaveLength(2);
    expect(galleryMocks.addGalleryEntries).toHaveBeenCalledTimes(1);
    const galleryEntries =
      (
        galleryMocks.addGalleryEntries.mock.calls as unknown as Array<
          [Array<Record<string, unknown>>]
        >
      )[0]?.[0] ?? [];
    expect(galleryEntries).toHaveLength(1);
    expect(galleryEntries[0]).toMatchObject({
      assetId: 'new-asset',
      outputId: 'output-new',
      promptId: 'prompt-new',
    });
  });

  it('does not re-add an already stored Comfy output to the app gallery', async () => {
    vi.stubGlobal('indexedDB', {});

    const existingOutput = {
      id: 'output-existing',
      src: 'existing-asset',
      width: 128,
      height: 96,
      createdAt: 200,
      promptId: 'prompt-existing',
    };
    const comfyNode: ComfyNode = {
      id: 'comfy-1',
      type: NodeType.COMFY,
      name: 'Comfy',
      enabled: true,
      workflows: [],
      selectedWorkflowId: 'workflow-1',
      src: existingOutput.src,
      width: existingOutput.width,
      height: existingOutput.height,
      opacity: 100,
      operator: BlendMode.OVER,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
      colorSpace: 'sRGB',
      generatedOutputs: [existingOutput],
    };
    const flow = buildFlowFromNodes([comfyNode], ROOT_FLOW_ID, 'Root Flow');
    const { actions, getState } = createHarness({
      initialState: {
        projectId: 'project-1',
        activeProjectBranchId: 'main',
        flows: { [ROOT_FLOW_ID]: flow },
        rootFlowId: ROOT_FLOW_ID,
        activeFlowId: ROOT_FLOW_ID,
        nodes: [comfyNode],
        selectedNodeId: comfyNode.id,
      },
    });

    const result = await actions.applyComfyNodeRunResult({
      projectId: 'project-1',
      nodeId: comfyNode.id,
      updates: {
        src: existingOutput.src,
        width: existingOutput.width,
        height: existingOutput.height,
        activeGeneratedOutputId: existingOutput.id,
      },
      newGeneratedOutputs: [existingOutput],
    });

    expect(result).toBe('current');
    expect((getState().nodes[0] as ComfyNode).generatedOutputs).toHaveLength(1);
    expect(galleryMocks.addGalleryEntries).not.toHaveBeenCalled();
  });

  it('keeps Comfy generated outputs related to gallery deletion state', async () => {
    const oldOutput = {
      id: 'output-old',
      src: 'old-asset',
      width: 64,
      height: 64,
      createdAt: 100,
      promptId: 'prompt-old',
    };
    const fallbackOutput = {
      id: 'output-fallback',
      src: 'fallback-asset',
      width: 128,
      height: 96,
      createdAt: 200,
      promptId: 'prompt-fallback',
    };
    const comfyNode: ComfyNode = {
      id: 'comfy-1',
      type: NodeType.COMFY,
      name: 'Comfy',
      enabled: true,
      workflows: [],
      selectedWorkflowId: 'workflow-1',
      src: oldOutput.src,
      width: oldOutput.width,
      height: oldOutput.height,
      opacity: 100,
      operator: BlendMode.OVER,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
      colorSpace: 'sRGB',
      generatedOutputs: [oldOutput, fallbackOutput],
      activeGeneratedOutputId: oldOutput.id,
    };
    const flow = buildFlowFromNodes([comfyNode], ROOT_FLOW_ID, 'Root Flow');
    const { actions, getState } = createHarness({
      initialState: {
        projectId: 'project-1',
        activeProjectBranchId: 'main',
        flows: { [ROOT_FLOW_ID]: flow },
        rootFlowId: ROOT_FLOW_ID,
        activeFlowId: ROOT_FLOW_ID,
        nodes: [comfyNode],
        selectedNodeId: comfyNode.id,
      },
    });
    const galleryEntry = {
      id: 'gallery-output-old',
      source: 'Comfy' as const,
      assetId: oldOutput.src,
      width: oldOutput.width,
      height: oldOutput.height,
      createdAt: oldOutput.createdAt,
      tags: ['project:project-1', 'branch:main', 'node:comfy-1', 'source:comfy'],
      outputId: oldOutput.id,
      promptId: oldOutput.promptId,
    };

    await actions.syncComfyGeneratedOutputsWithGalleryEntries({
      entries: [galleryEntry],
      mode: 'soft-delete',
      deletedAt: 123,
    });

    let currentNode = getState().nodes[0] as ComfyNode;
    expect(currentNode.generatedOutputs?.[0]?.deletedAt).toBe(123);

    await actions.syncComfyGeneratedOutputsWithGalleryEntries({
      entries: [galleryEntry],
      mode: 'restore',
    });

    currentNode = getState().nodes[0] as ComfyNode;
    expect(currentNode.generatedOutputs?.[0]?.deletedAt).toBeUndefined();

    await actions.syncComfyGeneratedOutputsWithGalleryEntries({
      entries: [galleryEntry],
      mode: 'permanent-delete',
    });

    currentNode = getState().nodes[0] as ComfyNode;
    expect(currentNode.generatedOutputs?.map((output) => output.id)).toEqual([fallbackOutput.id]);
    expect(currentNode.activeGeneratedOutputId).toBe(fallbackOutput.id);
    expect(currentNode.src).toBe(fallbackOutput.src);
  });

  it('keeps gallery output assets when deleting a project', async () => {
    const projectId = 'project-delete-gallery-assets';
    const imageNode: MediaSourceNode = {
      id: 'image-1',
      type: NodeType.MEDIA_SOURCE,
      name: 'Image',
      enabled: true,
      mediaKind: 'image',
      src: 'project-only-asset',
      width: 64,
      height: 64,
      opacity: 100,
      operator: BlendMode.OVER,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
      colorSpace: 'sRGB',
    };
    const comfyNode: ComfyNode = {
      id: 'comfy-1',
      type: NodeType.COMFY,
      name: 'Comfy',
      enabled: true,
      workflows: [],
      src: 'sequence-frame-a',
      mediaKind: 'image_sequence',
      frames: ['sequence-frame-a', 'sequence-frame-b'],
      width: 128,
      height: 96,
      opacity: 100,
      operator: BlendMode.OVER,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
      colorSpace: 'sRGB',
      generatedOutputs: [
        {
          id: 'sequence-output',
          src: 'sequence-frame-a',
          mediaKind: 'image_sequence',
          frames: ['sequence-frame-a', 'sequence-frame-b'],
          width: 128,
          height: 96,
          createdAt: 100,
        },
      ],
      activeGeneratedOutputId: 'sequence-output',
    };
    const flow = buildFlowFromNodes([imageNode, comfyNode], ROOT_FLOW_ID, 'Root Flow');
    vi.mocked(loadProjectState).mockResolvedValue({
      flows: { [ROOT_FLOW_ID]: flow },
      rootFlowId: ROOT_FLOW_ID,
      activeFlowId: ROOT_FLOW_ID,
    });
    galleryMocks.loadGalleryEntries.mockResolvedValue([
      {
        id: 'gallery-sequence',
        source: 'Comfy',
        assetId: 'sequence-frame-a',
        width: 128,
        height: 96,
        createdAt: 100,
        deletedAt: 200,
        tags: [`project:${projectId}`, 'branch:main', 'node:comfy-1', 'source:comfy'],
        outputId: 'sequence-output',
      },
    ]);

    const { actions } = createHarness();

    await actions.deleteProject(projectId);

    expect(deleteAssets).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deleteAssets).mock.calls[0]?.[0]).toEqual(['project-only-asset']);
    expect(deleteProjectFromStorage).toHaveBeenCalledWith(projectId);
  });

  it('adds a completed Comfy output to gallery state without activating it when history moved', async () => {
    const comfyNode: ComfyNode = {
      id: 'comfy-1',
      type: NodeType.COMFY,
      name: 'Comfy',
      enabled: true,
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
    const flow = buildFlowFromNodes([comfyNode], ROOT_FLOW_ID, 'Root Flow');
    const redoFlow = buildFlowFromNodes([redoNode], ROOT_FLOW_ID, 'Root Flow');
    const { actions, getState } = createHarness({
      initialState: {
        projectId: 'project-1',
        activeProjectBranchId: 'main',
        flows: { [ROOT_FLOW_ID]: flow },
        rootFlowId: ROOT_FLOW_ID,
        activeFlowId: ROOT_FLOW_ID,
        nodes: [comfyNode],
        history: [
          {
            id: 'hist-undone',
            label: 'Undone state',
            state: {
              flows: { [ROOT_FLOW_ID]: flow },
              rootFlowId: ROOT_FLOW_ID,
              activeFlowId: ROOT_FLOW_ID,
              selectedNodeId: comfyNode.id,
            },
          },
          {
            id: 'hist-run-start',
            label: 'Run start state',
            state: {
              flows: { [ROOT_FLOW_ID]: redoFlow },
              rootFlowId: ROOT_FLOW_ID,
              activeFlowId: ROOT_FLOW_ID,
              selectedNodeId: comfyNode.id,
            },
          },
        ],
        historyIndex: 0,
        selectedNodeId: comfyNode.id,
      },
    });

    const result = await actions.applyComfyNodeRunResult({
      projectId: 'project-1',
      nodeId: comfyNode.id,
      updates: {
        src: 'new-asset',
        width: 128,
        height: 96,
        activeGeneratedOutputId: 'output-1',
      },
      newGeneratedOutputs: [
        {
          id: 'output-1',
          src: 'new-asset',
          width: 128,
          height: 96,
          createdAt: 123,
        },
      ],
      withHistory: true,
      expectedHistoryId: 'hist-run-start',
    });

    const state = getState();
    const currentNode = state.nodes[0] as ComfyNode;

    expect(result).toBe('gallery');
    expect(state.history).toHaveLength(2);
    expect(state.historyIndex).toBe(0);
    expect(currentNode.src).toBe('old-asset');
    expect(currentNode.activeGeneratedOutputId).toBeUndefined();
    expect(currentNode.generatedOutputs).toHaveLength(1);
    const undoneHistoryNode = getOrderedNodesFromFlow(
      state.history[0].state.flows?.[ROOT_FLOW_ID] ?? null,
    )[0] as ComfyNode;
    const runStartHistoryNode = getOrderedNodesFromFlow(
      state.history[1].state.flows?.[ROOT_FLOW_ID] ?? null,
    )[0] as ComfyNode;
    expect(undoneHistoryNode.generatedOutputs).toHaveLength(1);
    expect(runStartHistoryNode.generatedOutputs).toHaveLength(1);
  });

  it('does not stop roto tracking for a single outlier drift point', async () => {
    const sceneNode: SceneNode = {
      id: 'scene-1',
      type: NodeType.SCENE,
      name: 'Scene',
      enabled: true,
      width: 20,
      height: 20,
      bitDepth: 16,
      colorSpace: 'Linear',
      maxFrames: 1,
      fps: 24,
    };
    const imageNode: MediaSourceNode = {
      id: 'image-1',
      type: NodeType.MEDIA_SOURCE,
      name: 'Plate',
      enabled: true,
      mediaKind: 'image',
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
      enabled: true,
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
      enabled: true,
      width: 20,
      height: 20,
      bitDepth: 16,
      colorSpace: 'Linear',
      maxFrames: 1,
      fps: 24,
    };
    const imageNode: MediaSourceNode = {
      id: 'image-1',
      type: NodeType.MEDIA_SOURCE,
      name: 'Plate',
      enabled: true,
      mediaKind: 'image',
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
      enabled: true,
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
      colorManagement: initialState.colorManagement,
      selectedNodeId: rotoNode.id,
      viewerNodeId: null,
      viewerSlots: {},
      activeViewerSlot: null,
      renderSettings: initialState.renderSettings,
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
    expect('history' in (savedState ?? {})).toBe(false);
    expect('historyIndex' in (savedState ?? {})).toBe(false);
  });
});
