import React from 'react';
import { BlendMode, ViewerSlotAssignments } from '@blackboard/types';
import { ViewerSlotBadges } from '@/components';
import { InputPortDot, OutputPortDot } from './NodeCard';
import { Merge } from '@blackboard/icons';
import { getBlendModeLabel } from '@/features/nodes/nodeVisualHelpers';

// --- Main Component ---

export interface MergeNodeCardProps {
  mergeId: string;
  blendMode?: BlendMode;
  opacity?: number;
  isSelected: boolean;
  viewerNodeId: string | null;
  viewerSlots: ViewerSlotAssignments;
  registerPortRef: (key: string, el: HTMLDivElement | null) => void;
  onSelect: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  /** Number of source inputs (e.g., 2 for a two-source merge). */
  inputCount: number;
}

const MergeNodeCard: React.FC<MergeNodeCardProps> = ({
  mergeId,
  blendMode,
  opacity,
  isSelected,
  viewerNodeId,
  viewerSlots,
  registerPortRef,
  onSelect,
  onDragStart,
  inputCount,
}) => {
  const inputPorts = Array.from({ length: inputCount }, (_, i) => ({
    key: `merge-input-${i}`,
    label: i === 0 ? 'Background' : i === 1 ? 'Source' : `Source ${i}`,
  }));

  const opacityDisplay = opacity != null ? `${Math.round(opacity)}%` : '100%';

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onMouseDown={onDragStart}
      className={[
        'relative cursor-pointer transition-colors select-none',
        'rounded-lg bg-gray-800/50 border-2 w-48',
        isSelected ? 'border-primary-500' : 'border-gray-700/50 hover:border-gray-600',
      ].join(' ')}
    >
      {/* Input ports at top */}
      <div
        className="absolute gap-3 left-0 right-0 flex justify-center pointer-events-auto"
        style={{ top: 0, transform: 'translateY(-50%)', zIndex: 15 }}
      >
        {[...inputPorts].reverse().map((port, idx, arr) => {
          const originalIdx = arr.length - 1 - idx;
          return (
            <InputPortDot
              key={port.key}
              nodeId={mergeId}
              portName={`merge-input-${originalIdx}`}
              label={port.label}
              isConnected={true}
              isDragTarget={false}
              portRef={(el) => registerPortRef(`${mergeId}:input:merge-input-${originalIdx}`, el)}
            />
          );
        })}
      </div>

      {/* Card body — matches StackNodeCard layout */}
      <div className="flex flex-col justify-start gap-0.5 p-2">
        <div className="flex w-full flex-col items-start gap-2 rounded-md p-2 bg-gray-900/70">
          <div className="flex items-center gap-2 w-full">
            <div className="flex-shrink-0 text-gray-400">
              <Merge className="h-4 w-4" />
            </div>
            <span className="text-xs text-gray-300 font-medium truncate flex-1">Merge</span>
            <ViewerSlotBadges
              nodeId={mergeId}
              viewerNodeId={viewerNodeId}
              viewerSlots={viewerSlots}
            />
          </div>
          <div className="flex items-center gap-3 w-full text-[10px] text-gray-500 font-mono">
            <span>{getBlendModeLabel(blendMode)}</span>
            <span className="text-gray-600">|</span>
            <span>Mix {opacityDisplay}</span>
          </div>
        </div>
      </div>

      {/* Output port at bottom */}
      <div
        className="absolute left-1/2 flex justify-center pointer-events-auto"
        style={{ bottom: 0, transform: 'translate(-50%, 50%)', zIndex: 15 }}
      >
        <OutputPortDot portRef={(el) => registerPortRef(`${mergeId}:output`, el)} />
      </div>
    </div>
  );
};

export default MergeNodeCard;
