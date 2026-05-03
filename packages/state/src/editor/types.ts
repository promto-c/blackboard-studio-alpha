import {
  AiChatThread,
  EditorTab,
  Flow,
  FlowId,
  HistoryEntry,
  NodePositions,
  RenderSettings,
  ViewerSettings,
  ViewerSlot,
  ViewerSlotAssignments,
} from '@blackboard/types';

export interface AutosaveSnapshot {
  projectId: string | null;
  flows: Record<FlowId, Flow>;
  rootFlowId: FlowId | null;
  activeFlowId: FlowId | null;
  activeTab: EditorTab;
  aiChats: AiChatThread[];
  activeAiChatId: string | null;
  selectedNodeId: string | null;
  history: HistoryEntry[];
  historyIndex: number;
  thumbnail: string | null;
  viewerNodeId: string | null;
  viewerSlots: ViewerSlotAssignments;
  activeViewerSlot: ViewerSlot | null;
  renderSettings: RenderSettings;
  viewerSettings: ViewerSettings;
  fps: number;
  currentFrame: number;
  nodePositionsByFlow: Record<FlowId, NodePositions>;
}
