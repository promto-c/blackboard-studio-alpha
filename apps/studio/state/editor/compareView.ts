import type { ViewerSlot } from '@blackboard/types';

export type CompareMode = 'wipe' | 'split';
export type CompareOrientation = 'vertical' | 'horizontal';
export type CompareWipeReference = 'canvas' | 'viewport' | 'cursor';
export type CompareSizingMode = 'fit' | 'fill' | 'none';

export interface CompareViewState {
  isActive: boolean;
  slotA: ViewerSlot | null;
  slotB: ViewerSlot | null;
  sidesSwapped: boolean;
  mode: CompareMode;
  sizingMode: CompareSizingMode;
  sizingRequestId: number;
  dividerPosition: number;
  wipe: {
    orientation: CompareOrientation;
    reference: CompareWipeReference;
  };
}

export const createInitialCompareViewState = (): CompareViewState => ({
  isActive: false,
  slotA: null,
  slotB: null,
  sidesSwapped: false,
  mode: 'wipe',
  sizingMode: 'fit',
  sizingRequestId: 0,
  dividerPosition: 0.5,
  wipe: {
    orientation: 'vertical',
    reference: 'cursor',
  },
});

/** Preserve compare preferences while returning the viewer to a single-slot presentation. */
export const deactivateCompareView = (state: CompareViewState): CompareViewState => ({
  ...state,
  isActive: false,
  slotA: null,
  slotB: null,
  sidesSwapped: false,
  dividerPosition: 0.5,
});
