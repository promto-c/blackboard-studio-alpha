import {
  getInitialHistoryEntry as getBaseInitialHistoryEntry,
  getInitialState as getBaseInitialState,
} from '@blackboard/state';
import { AnyNode, NodePositions } from '@blackboard/types';
import {
  loadPersistedBackgroundJobs,
  type BackgroundJob,
} from '@/state/editor/services/backgroundJobs';
import { MAIN_PROJECT_BRANCH_ID, type ProjectBranchRecord } from '@/state/projectBranches';

export const getInitialHistoryEntry = getBaseInitialHistoryEntry;
export const getInitialState = () => ({
  ...getBaseInitialState(),
  activeProjectBranchId: MAIN_PROJECT_BRANCH_ID,
  projectBranches: [] as ProjectBranchRecord[],
  isFrameScrubbing: false,
  playbackDirection: 1 as 1 | -1,
  selectedPaintLayerIds: [] as string[],
  selectedPaintStrokeIds: [] as string[],
  selectedRotoLayerIds: [] as string[],
  isSubPanelVisible: true,
  aiApplyNotice: null as null | {
    id: string;
    nodeId: string;
    field: 'shader' | 'prompt' | 'grade' | 'comfy-output';
    fieldId?: string;
    label: string;
    createdAt: number;
  },
  nodes: [] as AnyNode[],
  nodePositions: {} as NodePositions,
  backgroundJobs: loadPersistedBackgroundJobs() as BackgroundJob[],
});
