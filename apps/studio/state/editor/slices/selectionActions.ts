import { type RotoPointRef, SelectedKeyframeRef } from '@blackboard/types';
import { getDefaultViewportTool } from '@/effects/effectHelpers';
import { getOrderedNodesFromFlow, getRootFlow } from '@/state/editor/flowModel';
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

export function createSelectionActions(set: SetState, get: GetState) {
  return {
    selectNode: (nodeId: string | null) => {
      const state = get();
      const nodes = getOrderedNodesFromFlow(getRootFlow(state.flows, state.rootFlowId));
      if (nodeId === state.selectedNodeId) return;

      const nextNode = nodes.find((node) => node.id === nodeId);
      const defaultViewportTool = getDefaultViewportTool(nextNode?.type);

      set(() => ({
        selectedNodeId: nodeId,
        activeViewportTool: defaultViewportTool,
        selectedPaintLayerIds: [],
        selectedPaintStrokeIds: [],
        selectedRotoLayerIds: [],
        selectedRotoPathIds: [],
        selectedRotoPointRefs: [],
        selectedKeyframes: [],
      }));
    },

    setSelectedPaintLayerIds: (layerIds: string[]) =>
      set(() => ({
        selectedPaintLayerIds: layerIds,
      })),

    setSelectedPaintStrokeIds: (strokeIds: string[]) =>
      set(() => ({
        selectedPaintStrokeIds: strokeIds,
      })),

    setSelectedRotoPathIds: (pathIds: string[]) =>
      set((state) => ({
        selectedRotoPathIds: pathIds,
        selectedRotoLayerIds: pathIds.length > 0 ? [] : state.selectedRotoLayerIds,
        selectedRotoPointRefs: [],
      })),

    setSelectedRotoLayerIds: (layerIds: string[]) =>
      set((state) => ({
        selectedRotoLayerIds: layerIds,
        selectedRotoPathIds: layerIds.length > 0 ? [] : state.selectedRotoPathIds,
        selectedRotoPointRefs: layerIds.length > 0 ? [] : state.selectedRotoPointRefs,
      })),

    setSelectedRotoSelection: ({
      layerIds,
      pathIds,
      pointRefs,
    }: {
      layerIds: string[];
      pathIds: string[];
      pointRefs?: RotoPointRef[];
    }) =>
      set(() => ({
        selectedRotoLayerIds: layerIds,
        selectedRotoPathIds: pathIds,
        ...deriveRotoPointSelection(pointRefs),
      })),

    setSelectedKeyframes: (keyframes: SelectedKeyframeRef[]) =>
      set(() => ({ selectedKeyframes: keyframes })),
  };
}
