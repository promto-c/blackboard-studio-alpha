import {
  AnyNode,
  EditorTab,
  HistoryEntry,
  PersistedProjectState,
  type ProjectColorManagement,
} from '@blackboard/types';
import { getInitialState } from '@/state/editor/initialState';
import { buildFlowFromNodes, ROOT_FLOW_ID } from '@/state/editor/flowModel';
import { computeAutoLayout } from '@/utils/autoLayoutGraph';
import { buildNodeStacks } from '@/utils/nodeStacks';
import {
  cloneProjectColorManagement,
  createDefaultProjectColorManagement,
} from '@/color-management';

interface BuildProjectInitParams {
  nodes: AnyNode[];
  selectedNodeId: string;
  fps?: number;
  colorManagement?: ProjectColorManagement;
}

export const buildProjectInitState = ({
  nodes,
  selectedNodeId,
  fps = 30,
  colorManagement,
}: BuildProjectInitParams): {
  historyEntry: HistoryEntry;
  persistedState: PersistedProjectState;
} => {
  const rootFlow = buildFlowFromNodes(nodes, ROOT_FLOW_ID, 'Root Flow');
  const nodePositions = computeAutoLayout(buildNodeStacks(nodes));
  const nodePositionsByFlow = { [rootFlow.id]: nodePositions };
  const timestamp = Date.now();
  const projectColorManagement = colorManagement ?? createDefaultProjectColorManagement();

  const historyEntry: HistoryEntry = {
    id: `init_${timestamp}`,
    label: 'New Project',
    createdAt: timestamp,
    state: {
      flows: { [rootFlow.id]: rootFlow },
      rootFlowId: rootFlow.id,
      activeFlowId: rootFlow.id,
      selectedNodeId,
      selectedNodeIds: selectedNodeId ? [selectedNodeId] : [],
      colorManagement: cloneProjectColorManagement(projectColorManagement),
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
  const persistedState: PersistedProjectState = {
    flows: { [rootFlow.id]: rootFlow },
    rootFlowId: rootFlow.id,
    activeFlowId: rootFlow.id,
    activeTab: EditorTab.Flow,
    colorManagement: cloneProjectColorManagement(projectColorManagement),
    aiChats: [],
    activeAiChatId: null,
    selectedNodeId,
    selectedNodeIds: selectedNodeId ? [selectedNodeId] : [],
    viewerNodeId: null,
    viewerSlots: initialState.viewerSlots,
    activeViewerSlot: initialState.activeViewerSlot,
    renderSettings: initialState.renderSettings,
    fps,
    nodePositionsByFlow,
    history: [historyEntry],
    historyIndex: 0,
  };

  return { historyEntry, persistedState };
};
