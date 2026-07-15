import type { ViewerSlot, ViewerSlotAssignments } from '@blackboard/types';
import { getViewerSlotsForNode } from '@/utils/viewerSlots';

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
      {slots.map((slot) => (
        <span
          key={`${nodeId}-viewer-slot-${slot}`}
          data-viewer-slot-state={
            compareViewerSlots?.has(slot) ? 'compare' : isActiveViewerNode ? 'active' : 'assigned'
          }
          className={`w-4 h-4 rounded-full text-[10px] font-semibold flex items-center justify-center ring-1 ring-inset ${
            compareViewerSlots?.has(slot)
              ? 'bg-primary-500/45 text-white ring-primary-200/90 shadow-[0_0_8px_rgb(var(--color-primary-400)/0.45)]'
              : isActiveViewerNode
                ? 'bg-primary-500/40 text-white ring-primary-300/70'
                : 'bg-gray-700/80 text-gray-200 ring-gray-500/60'
          }`}
          title={`Viewer Slot ${slot}${compareViewerSlots?.has(slot) ? ' · Compare' : ''}`}
        >
          {slot}
        </span>
      ))}
    </div>
  );
}
