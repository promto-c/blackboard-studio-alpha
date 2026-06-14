import { EditorTab, Pan, TransformData, StabilizationConfig } from '@blackboard/types';
import { nodeRegistry } from '@/nodes/registry';
import type { SetState, GetState } from '@/state/editor/slices/types';

export function createViewportUIActions(set: SetState, get: GetState) {
  return {
    setActiveTab: (tab: EditorTab) => set(() => ({ activeTab: tab })),
    setSubPanelVisible: (visible: boolean) => set(() => ({ isSubPanelVisible: visible })),
    setZoom: (zoom: number) => set(() => ({ zoom })),
    setPan: (pan: Pan) => set(() => ({ pan })),
    setAnimationTarget: (targets: { zoom?: number; pan?: Pan }) =>
      set((s) => ({
        targetZoom: targets.zoom ?? s.targetZoom,
        targetPan: targets.pan ?? s.targetPan,
      })),
    setActiveViewportTool: (tool: string | null) => set(() => ({ activeViewportTool: tool })),

    toggleStabilize: () => {
      const state = get();
      const {
        isStabilized,
        nodes,
        selectedNodeId,
        currentFrame,
        stabilizationConfig,
        hierarchySelections,
      } = state;
      const hierarchySel = hierarchySelections[selectedNodeId ?? ''];
      const selectedRotoLayerIds = hierarchySel?.layerIds ?? [];
      const selectedRotoPathIds = hierarchySel?.itemIds ?? [];

      if (isStabilized) {
        set(() => ({
          isStabilized: false,
          stabilizationReference: null,
          stabilizationReferenceFrame: null,
        }));
      } else {
        let ref: TransformData | null = null;
        const node = nodes.find((l) => l.id === selectedNodeId);

        if (node) {
          const def = nodeRegistry.get(node.type);
          if (def && def.getStabilizeTransform) {
            ref = def.getStabilizeTransform(node, currentFrame, {
              stabilizationConfig,
              selectedRotoLayerIds,
              selectedRotoPathIds,
            });
          }
        }

        set(() => ({
          isStabilized: true,
          stabilizationReference: ref,
          stabilizationReferenceFrame: currentFrame,
        }));
      }
    },

    recaptureStabilizationReference: () => {
      const state = get();
      const {
        isStabilized,
        nodes,
        selectedNodeId,
        currentFrame,
        stabilizationConfig,
        hierarchySelections,
      } = state;
      const hierarchySel = hierarchySelections[selectedNodeId ?? ''];
      const selectedRotoLayerIds = hierarchySel?.layerIds ?? [];
      const selectedRotoPathIds = hierarchySel?.itemIds ?? [];

      if (!isStabilized) return;

      let ref: TransformData | null = null;
      const node = nodes.find((l) => l.id === selectedNodeId);

      if (node) {
        const def = nodeRegistry.get(node.type);
        if (def && def.getStabilizeTransform) {
          ref = def.getStabilizeTransform(node, currentFrame, {
            stabilizationConfig,
            selectedRotoLayerIds,
            selectedRotoPathIds,
          });
        }
      }

      set(() => ({
        stabilizationReference: ref,
        stabilizationReferenceFrame: currentFrame,
      }));
    },

    setStabilizationConfig: (config: Partial<StabilizationConfig>) =>
      set((s) => ({
        stabilizationConfig: { ...s.stabilizationConfig, ...config },
      })),
  };
}
