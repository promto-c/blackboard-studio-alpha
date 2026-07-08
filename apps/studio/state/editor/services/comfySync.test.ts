import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BlendMode,
  type ComfyNode,
  type GeneratedOutput,
  type HistoryEntry,
  ImageFitMode,
  NodeType,
} from '@blackboard/types';
import type { GalleryEntry } from '@blackboard/project-store';
import { createCommitMutation } from '@/state/editor/commitMutation';
import { getInitialState } from '@/state/editor/initialState';
import {
  buildFlowFromNodes,
  getOrderedNodesFromFlow,
  getRootFlow,
  ROOT_FLOW_ID,
} from '@/state/editor/flowModel';
import { createHistoryActions } from '@/state/editor/slices/historyActions';
import type { EditorState } from '@/state/editor/slices/types';
import {
  syncComfyGalleryEntriesAfterHistoryRestore,
  syncComfyGeneratedOutputsWithGalleryEntriesService,
  type ComfyGallerySyncMode,
} from './comfySync';

type TestState = EditorState;

const galleryStoreMocks = vi.hoisted(() => ({
  loadGalleryEntries: vi.fn(async () => [] as GalleryEntry[]),
  restoreGalleryEntries: vi.fn(async () => undefined),
  updateGalleryEntry: vi.fn(async () => undefined),
}));

vi.mock('@blackboard/project-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@blackboard/project-store')>();
  return {
    ...actual,
    loadGalleryEntries: galleryStoreMocks.loadGalleryEntries,
    restoreGalleryEntries: galleryStoreMocks.restoreGalleryEntries,
    updateGalleryEntry: galleryStoreMocks.updateGalleryEntry,
  };
});

const makeOutput = (overrides: Partial<GeneratedOutput> = {}): GeneratedOutput => ({
  id: 'output-1',
  src: 'asset-1',
  width: 64,
  height: 64,
  createdAt: 100,
  ...overrides,
});

const makeComfyNode = (outputs: GeneratedOutput[]): ComfyNode => ({
  id: 'comfy-1',
  type: NodeType.COMFY,
  name: 'Comfy',
  enabled: true,
  workflows: [],
  selectedWorkflowId: 'workflow-1',
  src: outputs.find((output) => !output.deletedAt)?.src ?? '',
  width: outputs.find((output) => !output.deletedAt)?.width ?? 0,
  height: outputs.find((output) => !output.deletedAt)?.height ?? 0,
  opacity: 100,
  operator: BlendMode.OVER,
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
  colorSpace: 'sRGB',
  generatedOutputs: outputs,
  activeGeneratedOutputId: outputs.find((output) => !output.deletedAt)?.id,
});

const makeGalleryEntry = (
  output: GeneratedOutput,
  overrides: Partial<GalleryEntry> = {},
): GalleryEntry => ({
  id: `gallery-${output.id}`,
  source: 'Comfy',
  assetId: output.src,
  width: output.width,
  height: output.height,
  createdAt: output.createdAt,
  tags: ['project:project-1', 'branch:main', 'node:comfy-1', 'source:comfy'],
  outputId: output.id,
  ...overrides,
});

const normalizeState = (previous: TestState, patch: Partial<TestState> | TestState): TestState => {
  const next = { ...previous, ...patch } as TestState;
  if ('flows' in patch || 'rootFlowId' in patch || 'activeFlowId' in patch) {
    const activeFlow = getRootFlow(next.flows, next.activeFlowId ?? next.rootFlowId);
    next.nodes = getOrderedNodesFromFlow(activeFlow);
  }
  return next;
};

const getOutputFromNodes = (
  nodes: TestState['nodes'],
  outputId = 'output-1',
): GeneratedOutput | undefined =>
  (nodes.find((node) => node.id === 'comfy-1') as ComfyNode | undefined)?.generatedOutputs?.find(
    (output) => output.id === outputId,
  );

const getOutputFromHistory = (
  entry: HistoryEntry | undefined,
  outputId = 'output-1',
): GeneratedOutput | undefined => {
  const flow = getRootFlow(entry?.state.flows ?? {}, entry?.state.activeFlowId ?? ROOT_FLOW_ID);
  return getOutputFromNodes(getOrderedNodesFromFlow(flow), outputId);
};

const createHarness = (outputs: GeneratedOutput[]) => {
  const node = makeComfyNode(outputs);
  const flow = buildFlowFromNodes([node], ROOT_FLOW_ID, 'Root Flow');
  const initialHistoryEntry: HistoryEntry = {
    id: 'hist_initial',
    label: 'Initial State',
    state: {
      flows: { [ROOT_FLOW_ID]: flow },
      rootFlowId: ROOT_FLOW_ID,
      activeFlowId: ROOT_FLOW_ID,
      selectedNodeId: node.id,
    },
  };
  let state: TestState = {
    ...getInitialState(),
    maxFrames: 0,
    projectId: 'project-1',
    activeProjectBranchId: 'main',
    flows: { [ROOT_FLOW_ID]: flow },
    rootFlowId: ROOT_FLOW_ID,
    activeFlowId: ROOT_FLOW_ID,
    nodes: [node],
    selectedNodeId: node.id,
    history: [initialHistoryEntry],
    historyIndex: 0,
    galleryUpdatedAt: 0,
  };
  const set = (fn: (prevState: TestState) => Partial<TestState> | TestState) => {
    state = normalizeState(state, fn(state));
  };
  const get = () => state;
  const debouncedSave = vi.fn();
  const historyActions = createHistoryActions(set as never, get as never, debouncedSave);
  const commitMutation = createCommitMutation<TestState>(set, get, {
    pushHistory: historyActions.pushHistory,
    debouncedSave,
  });
  const sync = (entries: GalleryEntry[], mode: ComfyGallerySyncMode, deletedAt?: number) =>
    syncComfyGeneratedOutputsWithGalleryEntriesService(
      set as never,
      get as never,
      { commitMutation },
      entries,
      mode,
      deletedAt,
    );

  return {
    getState: () => state,
    historyActions,
    sync,
  };
};

describe('syncComfyGeneratedOutputsWithGalleryEntriesService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    galleryStoreMocks.loadGalleryEntries.mockResolvedValue([]);
  });

  it('pushes undoable history for active gallery soft deletes', async () => {
    const output = makeOutput();
    const { getState, historyActions, sync } = createHarness([output]);

    await sync([makeGalleryEntry(output)], 'soft-delete', 123);

    expect(getOutputFromNodes(getState().nodes)?.deletedAt).toBe(123);
    expect(getState().history).toHaveLength(2);
    expect(getState().historyIndex).toBe(1);
    expect(getState().history[1]?.label).toBe('Delete 1 Gallery Output');
    expect(getOutputFromHistory(getState().history[0])?.deletedAt).toBeUndefined();

    historyActions.undo();

    expect(getState().historyIndex).toBe(0);
    expect(getOutputFromNodes(getState().nodes)?.deletedAt).toBeUndefined();

    historyActions.redo();

    expect(getState().historyIndex).toBe(1);
    expect(getOutputFromNodes(getState().nodes)?.deletedAt).toBe(123);
  });

  it('pushes undoable history for active gallery restores', async () => {
    const output = makeOutput({ deletedAt: 123 });
    const { getState, historyActions, sync } = createHarness([output]);

    await sync([makeGalleryEntry(output)], 'restore');

    expect(getOutputFromNodes(getState().nodes)?.deletedAt).toBeUndefined();
    expect(getState().history).toHaveLength(2);
    expect(getState().history[1]?.label).toBe('Restore 1 Gallery Output');
    expect(getOutputFromHistory(getState().history[0])?.deletedAt).toBe(123);

    historyActions.undo();

    expect(getOutputFromNodes(getState().nodes)?.deletedAt).toBe(123);

    historyActions.redo();

    expect(getOutputFromNodes(getState().nodes)?.deletedAt).toBeUndefined();
  });

  it('keeps permanent gallery deletes non-undoable by rewriting existing history', async () => {
    const deletedOutput = makeOutput({ id: 'output-delete', src: 'asset-delete' });
    const fallbackOutput = makeOutput({ id: 'output-fallback', src: 'asset-fallback' });
    const { getState, historyActions, sync } = createHarness([deletedOutput, fallbackOutput]);

    await sync([makeGalleryEntry(deletedOutput)], 'permanent-delete');

    const currentNode = getState().nodes[0] as ComfyNode;
    expect(currentNode.generatedOutputs?.map((output) => output.id)).toEqual(['output-fallback']);
    expect(currentNode.activeGeneratedOutputId).toBe('output-fallback');
    expect(getState().history).toHaveLength(1);
    expect(getOutputFromHistory(getState().history[0], 'output-delete')).toBeUndefined();

    historyActions.undo();

    expect((getState().nodes[0] as ComfyNode).generatedOutputs?.map((output) => output.id)).toEqual(
      ['output-fallback'],
    );
  });

  it('refreshes gallery observers without duplicate history when the node is already synced', async () => {
    const output = makeOutput({ deletedAt: 123 });
    const { getState, sync } = createHarness([output]);

    await sync([makeGalleryEntry(output)], 'soft-delete', 123);

    expect(getState().history).toHaveLength(1);
    expect(getState().galleryUpdatedAt).toBeGreaterThan(0);
  });

  it('restores gallery entries after undo restores a Comfy output', async () => {
    const visibleOutput = makeOutput();
    const deletedOutput = makeOutput({ deletedAt: 123 });
    const visibleNode = makeComfyNode([visibleOutput]);
    const deletedNode = makeComfyNode([deletedOutput]);
    const visibleFlow = buildFlowFromNodes([visibleNode], ROOT_FLOW_ID, 'Root Flow');
    const deletedFlow = buildFlowFromNodes([deletedNode], ROOT_FLOW_ID, 'Root Flow');
    galleryStoreMocks.loadGalleryEntries.mockResolvedValue([
      makeGalleryEntry(visibleOutput, { deletedAt: 123 }),
    ]);

    const changed = await syncComfyGalleryEntriesAfterHistoryRestore({
      fromState: { flows: { [ROOT_FLOW_ID]: deletedFlow } },
      toState: { flows: { [ROOT_FLOW_ID]: visibleFlow } },
      editorState: {
        projectId: 'project-1',
        activeProjectBranchId: 'main',
        flows: { [ROOT_FLOW_ID]: visibleFlow },
        nodes: [visibleNode],
      },
    });

    expect(changed).toBe(true);
    expect(galleryStoreMocks.restoreGalleryEntries).toHaveBeenCalledWith(['gallery-output-1']);
    expect(galleryStoreMocks.updateGalleryEntry).not.toHaveBeenCalled();
  });

  it('moves gallery entries back to the bin after redo deletes a Comfy output', async () => {
    const visibleOutput = makeOutput();
    const deletedOutput = makeOutput({ deletedAt: 123 });
    const visibleNode = makeComfyNode([visibleOutput]);
    const deletedNode = makeComfyNode([deletedOutput]);
    const visibleFlow = buildFlowFromNodes([visibleNode], ROOT_FLOW_ID, 'Root Flow');
    const deletedFlow = buildFlowFromNodes([deletedNode], ROOT_FLOW_ID, 'Root Flow');
    galleryStoreMocks.loadGalleryEntries.mockResolvedValue([makeGalleryEntry(visibleOutput)]);

    const changed = await syncComfyGalleryEntriesAfterHistoryRestore({
      fromState: { flows: { [ROOT_FLOW_ID]: visibleFlow } },
      toState: { flows: { [ROOT_FLOW_ID]: deletedFlow } },
      editorState: {
        projectId: 'project-1',
        activeProjectBranchId: 'main',
        flows: { [ROOT_FLOW_ID]: deletedFlow },
        nodes: [deletedNode],
      },
    });

    expect(changed).toBe(true);
    expect(galleryStoreMocks.updateGalleryEntry).toHaveBeenCalledWith('gallery-output-1', {
      deletedAt: 123,
    });
    expect(galleryStoreMocks.restoreGalleryEntries).not.toHaveBeenCalled();
  });

  it('skips gallery storage work when history restore does not change Comfy deletion state', async () => {
    const output = makeOutput();
    const node = makeComfyNode([output]);
    const flow = buildFlowFromNodes([node], ROOT_FLOW_ID, 'Root Flow');

    const changed = await syncComfyGalleryEntriesAfterHistoryRestore({
      fromState: { flows: { [ROOT_FLOW_ID]: flow } },
      toState: { flows: { [ROOT_FLOW_ID]: flow } },
      editorState: {
        projectId: 'project-1',
        activeProjectBranchId: 'main',
        flows: { [ROOT_FLOW_ID]: flow },
        nodes: [node],
      },
    });

    expect(changed).toBe(false);
    expect(galleryStoreMocks.loadGalleryEntries).not.toHaveBeenCalled();
  });
});
