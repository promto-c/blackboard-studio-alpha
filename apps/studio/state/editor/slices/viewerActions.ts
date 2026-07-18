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
  orderViewerCompareSlots,
  sanitizeActiveViewerSlot,
  sanitizeViewerNodeId,
  sanitizeViewerSlots,
} from '@/utils/viewerSlots';
import {
  cloneProjectColorManagement,
  createDefaultViewerColorManagement,
  resolveCurrentViewerDisplayView,
} from '@/color-management';
import {
  deactivateCompareView,
  type CompareMode,
  type CompareOrientation,
  type CompareSizingMode,
  type CompareWipeReference,
} from '@/state/editor/compareView';

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

      if (
        !state.compareView.isActive &&
        state.activeViewerSlot === slot &&
        state.viewerNodeId === validNodeId
      ) {
        set(() => ({
          viewerNodeId: null,
          activeViewerSlot: null,
        }));
        return true;
      }

      set(() => ({
        viewerNodeId: validNodeId,
        activeViewerSlot: slot,
        ...(state.compareView.isActive
          ? { compareView: deactivateCompareView(state.compareView) }
          : {}),
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

    // ── Compare View Actions ─────────────────────────────────────

    enterCompareMode: (slotA: ViewerSlot, slotB: ViewerSlot) => {
      const state = get();
      const [baseSlot, comparisonSlot] = orderViewerCompareSlots(slotA, slotB);
      const nodeIdA = state.viewerSlots?.[baseSlot];
      const nodeIdB = state.viewerSlots?.[comparisonSlot];
      if (!nodeIdA || !nodeIdB) return false;

      const validA = sanitizeViewerNodeId(nodeIdA, state.nodes);
      const validB = sanitizeViewerNodeId(nodeIdB, state.nodes);
      if (!validA || !validB) return false;

      // The lower-numbered slot is the stable base rendered by the primary loop.
      set(() => ({
        compareView: {
          ...state.compareView,
          isActive: true,
          slotA: baseSlot,
          slotB: comparisonSlot,
          sidesSwapped: false,
        },
        viewerNodeId: validA,
        activeViewerSlot: baseSlot,
      }));
      return true;
    },

    exitCompareMode: () => {
      set((s) => ({
        compareView: deactivateCompareView(s.compareView),
      }));
    },

    setCompareMode: (mode: CompareMode) => {
      set((s) => ({
        compareView: { ...s.compareView, mode },
      }));
    },

    setCompareSizingMode: (sizingMode: CompareSizingMode) => {
      set((s) => ({
        compareView: {
          ...s.compareView,
          sizingMode,
          sizingRequestId: s.compareView.sizingRequestId + 1,
        },
      }));
    },

    setCompareWipeOrientation: (orientation: CompareOrientation) => {
      set((s) => ({
        compareView: {
          ...s.compareView,
          wipe: { ...s.compareView.wipe, orientation },
        },
      }));
    },

    setCompareWipeReference: (reference: CompareWipeReference) => {
      set((s) => ({
        compareView: {
          ...s.compareView,
          wipe: { ...s.compareView.wipe, reference },
        },
      }));
    },

    setCompareDividerPosition: (position: number) => {
      set((s) => ({
        compareView: { ...s.compareView, dividerPosition: position },
      }));
    },

    swapCompareSlots: () => {
      set((s) => {
        if (!s.compareView.isActive || !s.compareView.slotA || !s.compareView.slotB) return {};
        return {
          compareView: {
            ...s.compareView,
            sidesSwapped: !s.compareView.sidesSwapped,
          },
        };
      });
    },
  };
}
