import { type RotoPointRef, SelectedKeyframeRef } from '@blackboard/types';
import type { EditorStateSlice } from '@blackboard/types';
import { getDefaultViewportTool } from '@/nodes/helpers';
import { getOrderedNodesFromFlow, getRootFlow, OUTPUT_NODE_ID } from '@/state/editor/flowModel';
import type { SetState, GetState } from '@/state/editor/slices/types';

const getPointRefKey = ({ pathId, pointIndex }: RotoPointRef): string => `${pathId}:${pointIndex}`;

const dedupeRotoPointRefs = (pointRefs: readonly RotoPointRef[]): RotoPointRef[] => {
  const seen = new Set<string>();
  const deduped: RotoPointRef[] = [];
  pointRefs.forEach((pointRef) => {
    const key = getPointRefKey(pointRef);
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(pointRef);
  });
  return deduped;
};

const deriveRotoPointSelection = (
  pointRefs?: readonly RotoPointRef[],
): { selectedRotoPointRefs: RotoPointRef[] } => ({
  selectedRotoPointRefs: pointRefs ? dedupeRotoPointRefs(pointRefs) : [],
});

type HierarchySelections = Record<string, { layerIds: string[]; itemIds: string[] }>;

/** Get the hierarchy selection for a specific node, defaulting to empty. */
export const getHierarchySelection = (
  selections: HierarchySelections,
  nodeId: string | null | undefined,
): { layerIds: string[]; itemIds: string[] } =>
  nodeId && selections[nodeId] ? selections[nodeId] : { layerIds: [], itemIds: [] };

// ---------------------------------------------------------------------------
// Shared selector helpers for use with useEditorSelector
// ---------------------------------------------------------------------------

/** Select hierarchy selection for the currently selected node. */
export const selectHierarchySelection = (s: EditorStateSlice) =>
  getHierarchySelection(s.hierarchySelections, s.selectedNodeId);

/**
 * Set the hierarchy selection for a specific node.
 * This is the canonical setter — all write paths should go through this.
 */
export const setHierarchySelection = (
  set: SetState,
  nodeId: string,
  selection: { layerIds: string[]; itemIds: string[] },
): void => {
  set((state) => {
    const nextSelections = {
      ...state.hierarchySelections,
      [nodeId]: selection,
    };
    return {
      hierarchySelections: nextSelections,
      selectedRotoPointRefs: selection.layerIds.length > 0 ? [] : state.selectedRotoPointRefs,
      selectedKeyframes: [],
    };
  });
};

export function createSelectionActions(set: SetState, get: GetState) {
  return {
    selectNode: (nodeId: string | null) => {
      const state = get();
      const nodes = getOrderedNodesFromFlow(getRootFlow(state.flows, state.activeFlowId));
      if (nodeId === state.selectedNodeId) return;

      const nextNode = nodes.find((node) => node.id === nodeId);
      const defaultViewportTool = getDefaultViewportTool(nextNode?.type);

      set((s) => ({
        selectedNodeId: nodeId,
        selectedNodeIds: nodeId ? [nodeId] : [],
        activeViewportTool: defaultViewportTool,
        selectedRotoPointRefs: [],
        selectedKeyframes: [],
        hierarchySelections: s.hierarchySelections,
      }));
    },

    selectNodes: (nodeIds: string[]) => {
      const state = get();
      const activeFlow = getRootFlow(state.flows, state.activeFlowId);
      const nodes = getOrderedNodesFromFlow(activeFlow);
      const validNodeIds = new Set(nodes.map((node) => node.id));
      const activeOutputNodeId = activeFlow?.outputNodeId ?? OUTPUT_NODE_ID;
      if (activeFlow?.nodes.some((node) => node.id === activeOutputNodeId)) {
        validNodeIds.add(activeOutputNodeId);
      }
      const selectedNodeIds = Array.from(
        new Set(nodeIds.filter((nodeId) => validNodeIds.has(nodeId))),
      );
      const selectedNodeId = selectedNodeIds[selectedNodeIds.length - 1] ?? null;
      const nextNode = nodes.find((node) => node.id === selectedNodeId);

      set((s) => ({
        selectedNodeId,
        selectedNodeIds,
        activeViewportTool: getDefaultViewportTool(nextNode?.type),
        selectedRotoPointRefs: [],
        selectedKeyframes: [],
        hierarchySelections: s.hierarchySelections,
      }));
    },

    toggleNodeSelection: (nodeId: string) => {
      const state = get();
      const current = state.selectedNodeIds ?? (state.selectedNodeId ? [state.selectedNodeId] : []);
      const selectedNodeIds = current.includes(nodeId)
        ? current.filter((candidate) => candidate !== nodeId)
        : [...current, nodeId];
      const selectedNodeId = selectedNodeIds[selectedNodeIds.length - 1] ?? null;
      const nodes = getOrderedNodesFromFlow(getRootFlow(state.flows, state.activeFlowId));
      const nextNode = nodes.find((node) => node.id === selectedNodeId);

      set((s) => ({
        selectedNodeId,
        selectedNodeIds,
        activeViewportTool: getDefaultViewportTool(nextNode?.type),
        selectedRotoPointRefs: [],
        selectedKeyframes: [],
        hierarchySelections: s.hierarchySelections,
      }));
    },

    setHierarchySelection: (nodeId: string, layerIds: string[], itemIds: string[]) =>
      setHierarchySelection(set, nodeId, { layerIds, itemIds }),

    setSelectedRotoPointRefs: (pointRefs: RotoPointRef[]) =>
      set(() => deriveRotoPointSelection(pointRefs)),

    setSelectedKeyframes: (keyframes: SelectedKeyframeRef[]) =>
      set(() => ({ selectedKeyframes: keyframes })),
  };
}
