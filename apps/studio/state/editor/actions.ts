import {
  AnyNode,
  EditorStateSlice,
  EditorTab,
  HistoryEntry,
  NodePositions,
} from '@blackboard/types';
import { getInitialState } from '@/state/editor/initialState';
import { buildFlowFromNodes, ROOT_FLOW_ID } from '@/state/editor/flowModel';
import { computeAutoLayout } from '@/utils/autoLayoutGraph';
import { buildNodeStacks } from '@/utils/nodeStacks';

interface BuildProjectInitParams {
  nodes: AnyNode[];
  selectedNodeId: string;
  fps?: number;
}

export const buildProjectInitState = ({
  nodes,
  selectedNodeId,
  fps = 30,
}: BuildProjectInitParams): {
  historyEntry: HistoryEntry;
  persistedState: Omit<EditorStateSlice, 'projectId'>;
  nodePositions: NodePositions;
} => {
  const rootFlow = buildFlowFromNodes(nodes, ROOT_FLOW_ID, 'Root Flow');
  const nodePositions = computeAutoLayout(nodes, buildNodeStacks(nodes));
  const nodePositionsByFlow = { [rootFlow.id]: nodePositions };

  const historyEntry: HistoryEntry = {
    id: `init_${Date.now()}`,
    label: 'New Project',
    state: {
      flows: { [rootFlow.id]: rootFlow },
      rootFlowId: rootFlow.id,
      activeFlowId: rootFlow.id,
      selectedNodeId,
      viewerNodeId: null,
      viewerSlots: {},
      activeViewerSlot: null,
      zoom: 1,
      pan: { x: 0, y: 0 },
      fps,
      nodePositionsByFlow,
    },
  };

  const initialState = getInitialState();
  const persistedState: Omit<EditorStateSlice, 'projectId'> = {
    flows: { [rootFlow.id]: rootFlow },
    rootFlowId: rootFlow.id,
    activeFlowId: rootFlow.id,
    activeTab: EditorTab.Flow,
    aiChats: [],
    activeAiChatId: null,
    selectedNodeId,
    history: [historyEntry],
    historyIndex: 0,
    viewerNodeId: null,
    viewerSlots: initialState.viewerSlots,
    activeViewerSlot: initialState.activeViewerSlot,
    renderSettings: initialState.renderSettings,
    viewerSettings: initialState.viewerSettings,
    fps,
    nodePositionsByFlow,
  };

  return { historyEntry, persistedState, nodePositions };
};
