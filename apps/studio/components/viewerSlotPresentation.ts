import type { ViewerCompareSlotRole } from '@/utils/viewerSlots';

export const VIEWER_COMPARE_SLOT_CLASS: Record<ViewerCompareSlotRole, string> = {
  base: 'bg-primary-500/45 text-white ring-primary-200/90 shadow-[0_0_8px_rgb(var(--color-primary-400)/0.45)]',
  comparison:
    'bg-amber-500/35 text-amber-50 ring-amber-300/75 shadow-[0_0_8px_rgba(245,158,11,0.28)]',
};

export const VIEWER_COMPARE_SLOT_LABEL: Record<ViewerCompareSlotRole, string> = {
  base: 'Compare Base',
  comparison: 'Comparison',
};
