import React from 'react';
import { ViewerSlotAssignments } from '@blackboard/types';
import { getViewerSlotsForNode } from '@/utils/viewerSlots';

interface ViewerSlotBadgesProps {
  nodeId: string;
  viewerNodeId: string | null;
  viewerSlots: ViewerSlotAssignments;
}

const ViewerSlotBadges: React.FC<ViewerSlotBadgesProps> = ({
  nodeId,
  viewerNodeId,
  viewerSlots,
}) => {
  const slots = getViewerSlotsForNode(viewerSlots, nodeId);
  const isActiveViewerNode = viewerNodeId === nodeId;

  if (!isActiveViewerNode && slots.length === 0) return null;

  return (
    <div className="flex items-center gap-1 flex-shrink-0 ml-1">
      {slots.map((slot) => (
        <span
          key={`${nodeId}-viewer-slot-${slot}`}
          className={`w-4 h-4 rounded-full text-[10px] font-semibold flex items-center justify-center ring-1 ring-inset ${
            isActiveViewerNode
              ? 'bg-primary-500/40 text-white ring-primary-300/70'
              : 'bg-gray-700/80 text-gray-200 ring-gray-500/60'
          }`}
          title={`Viewer Slot ${slot}`}
        >
          {slot}
        </span>
      ))}
    </div>
  );
};

export default ViewerSlotBadges;
