import type { ViewerSlot, ViewerSlotAssignments } from '@blackboard/types';
import { getViewerCompareSlotRole, getViewerSlotsForNode } from '@/utils/viewerSlots';
import { VIEWER_COMPARE_SLOT_CLASS, VIEWER_COMPARE_SLOT_LABEL } from './viewerSlotPresentation';

interface ViewerSlotBadgesProps {
  nodeId: string;
  viewerNodeId: string | null;
  viewerSlots: ViewerSlotAssignments;
  compareViewerSlots?: ReadonlySet<ViewerSlot>;
}

export function ViewerSlotBadges({
  nodeId,
  viewerNodeId,
  viewerSlots,
  compareViewerSlots,
}: ViewerSlotBadgesProps) {
  const slots = getViewerSlotsForNode(viewerSlots, nodeId);
  const isActiveViewerNode = viewerNodeId === nodeId;

  if (!isActiveViewerNode && slots.length === 0) return null;

  return (
    <div className="flex items-center gap-1 flex-shrink-0 ml-1">
      {slots.map((slot) => {
        const compareRole = getViewerCompareSlotRole(slot, compareViewerSlots);
        const stateClassName = compareRole
          ? VIEWER_COMPARE_SLOT_CLASS[compareRole]
          : isActiveViewerNode
            ? 'bg-primary-500/40 text-white ring-primary-300/70'
            : 'bg-gray-700/80 text-gray-200 ring-gray-500/60';
        return (
          <span
            key={`${nodeId}-viewer-slot-${slot}`}
            data-viewer-slot-state={compareRole ?? (isActiveViewerNode ? 'active' : 'assigned')}
            className={`w-4 h-4 rounded-full text-[10px] font-semibold flex items-center justify-center ring-1 ring-inset ${stateClassName}`}
            title={`Viewer Slot ${slot}${compareRole ? ` · ${VIEWER_COMPARE_SLOT_LABEL[compareRole]}` : ''}`}
          >
            {slot}
          </span>
        );
      })}
    </div>
  );
}
