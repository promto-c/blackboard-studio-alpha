import {
  type DisplayViewSelection,
  type ProjectColorManagement,
  type ViewerSettings,
  type RenderSettings,
  type CacheStatus,
  type ViewerSlot,
  type ViewerSlotAssignments,
} from '@blackboard/types';
import { getInitialState } from '@/state/editor/initialState';
import type { EditorState, GetState, SetState } from '@/state/editor/slices/types';
import type { CommitEditorMutation } from '@/state/editor/commitMutation';
import {
  assignViewerSlotToNode,
  sanitizeActiveViewerSlot,
  sanitizeViewerNodeId,
  sanitizeViewerSlots,
} from '@/utils/viewerSlots';
import {
  cloneProjectColorManagement,
  createDefaultViewerColorManagement,
  resolveCurrentViewerDisplayView,
} from '@/color-management';

export function createViewerActions(
  set: SetState,
  get: GetState,
  deps: { commitMutation: CommitEditorMutation<EditorState> },
) {
  return {
    setProjectColorManagement: (
      colorManagement: ProjectColorManagement,
      options?: { historyLabel?: string },
    ) =>
      deps.commitMutation((state) => {
        const nextColorManagement = cloneProjectColorManagement(colorManagement);
        const history = options?.historyLabel
          ? state.history.map((entry, index) =>
              index === state.historyIndex
                ? {
                    ...entry,
                    state: {
                      ...entry.state,
                      colorManagement: cloneProjectColorManagement(state.colorManagement),
                    },
                  }
                : entry,
            )
          : state.history;
        return {
          patch: {
            colorManagement: nextColorManagement,
            ...(options?.historyLabel ? { history } : {}),
          },
          ...(options?.historyLabel
            ? {
                history: {
                  label: options.historyLabel,
                  state: {
                    colorManagement: cloneProjectColorManagement(nextColorManagement),
                  },
                },
              }
            : {}),
          persist: 'debounced',
        };
      }),

    setViewerDisplayView: (updates: Partial<DisplayViewSelection>) =>
      set((s) => {
        const current = resolveCurrentViewerDisplayView(
          s.colorManagement.viewer,
          s.viewerColorManagement,
        );
        return {
          viewerColorManagement: {
            ...s.viewerColorManagement,
            displayViewOverride: {
              ...current,
              ...updates,
            },
          },
        };
      }),

    setAutoDetectView: (autoDetectView: DisplayViewSelection | null) =>
      set((s) => ({
        viewerColorManagement: {
          ...s.viewerColorManagement,
          autoDetectView,
        },
      })),

    setViewerSettings: (updates: Partial<ViewerSettings>) =>
      set((s) => ({ viewerSettings: { ...s.viewerSettings, ...updates } })),

    resetViewerToProjectView: () =>
      set(() => ({
        viewerColorManagement: createDefaultViewerColorManagement(),
        viewerSettings: getInitialState().viewerSettings,
      })),

    toggleExposureDefault: () => {
      const { viewerSettings } = get();
      if (
        viewerSettings.gain !== 1 ||
        viewerSettings.gamma !== 1 ||
        viewerSettings.saturation !== 1
      ) {
        set((s) => ({
          viewerSettings: {
            ...s.viewerSettings,
            gain: 1,
            gamma: 1,
            saturation: 1,
            lastCustomGain: s.viewerSettings.gain,
            lastCustomGamma: s.viewerSettings.gamma,
            lastCustomSaturation: s.viewerSettings.saturation,
          },
        }));
      } else {
        set((s) => ({
          viewerSettings: {
            ...s.viewerSettings,
            gain: s.viewerSettings.lastCustomGain,
            gamma: s.viewerSettings.lastCustomGamma,
            saturation: s.viewerSettings.lastCustomSaturation,
          },
        }));
      }
    },

    setRenderSettings: (updates: Partial<RenderSettings>) =>
      deps.commitMutation((s) => ({
        patch: { renderSettings: { ...s.renderSettings, ...updates } },
        persist: 'debounced',
      })),

    updateCacheStatus: (status: Partial<CacheStatus>) =>
      set((s) => ({ cacheStatus: { ...s.cacheStatus, ...status } })),

    setViewerNode: (nodeId: string | null) => {
      const { nodes, viewerSlots } = get();
      const nextViewerNodeId = sanitizeViewerNodeId(nodeId, nodes);
      const nextActiveSlot = sanitizeActiveViewerSlot(
        get().activeViewerSlot,
        viewerSlots,
        nextViewerNodeId,
      );
      set(() => ({ viewerNodeId: nextViewerNodeId, activeViewerSlot: nextActiveSlot }));
    },

    assignViewerSlot: (slot: ViewerSlot, nodeId: string) => {
      const state = get();
      const validNodeId = sanitizeViewerNodeId(nodeId, state.nodes);
      if (!validNodeId) return false;

      const nextSlots: ViewerSlotAssignments = assignViewerSlotToNode(
        state.viewerSlots,
        slot,
        validNodeId,
      );
      set(() => ({
        viewerSlots: nextSlots,
        viewerNodeId: validNodeId,
        activeViewerSlot: slot,
      }));
      return true;
    },

    activateViewerSlot: (slot: ViewerSlot) => {
      const state = get();
      const nodeId = state.viewerSlots?.[slot];
      if (!nodeId) return false;

      const validNodeId = sanitizeViewerNodeId(nodeId, state.nodes);
      if (!validNodeId) return false;

      if (state.activeViewerSlot === slot && state.viewerNodeId === validNodeId) {
        set(() => ({
          viewerNodeId: null,
          activeViewerSlot: null,
        }));
        return true;
      }

      set(() => ({
        viewerNodeId: validNodeId,
        activeViewerSlot: slot,
      }));
      return true;
    },

    clearViewerSlot: (slot: ViewerSlot) => {
      const state = get();
      if (!state.viewerSlots?.[slot]) return;

      const nextSlots: ViewerSlotAssignments = { ...state.viewerSlots };
      delete nextSlots[slot];

      const nextViewerNodeId =
        state.activeViewerSlot === slot && state.viewerNodeId === state.viewerSlots[slot]
          ? null
          : state.viewerNodeId;
      const nextActiveSlot =
        state.activeViewerSlot === slot
          ? null
          : sanitizeActiveViewerSlot(state.activeViewerSlot, nextSlots, state.viewerNodeId);

      set(() => ({
        viewerSlots: nextSlots,
        viewerNodeId: nextViewerNodeId,
        activeViewerSlot: nextActiveSlot,
      }));
    },

    sanitizeViewerRouting: () => {
      const state = get();
      const nextSlots = sanitizeViewerSlots(state.viewerSlots, state.nodes);
      const nextViewerNodeId = sanitizeViewerNodeId(state.viewerNodeId, state.nodes);
      const nextActiveSlot = sanitizeActiveViewerSlot(
        state.activeViewerSlot,
        nextSlots,
        nextViewerNodeId,
      );

      set(() => ({
        viewerSlots: nextSlots,
        viewerNodeId: nextViewerNodeId,
        activeViewerSlot: nextActiveSlot,
      }));
    },
  };
}
