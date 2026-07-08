import React from 'react';
import { BlendMode, type AnyNode } from '@blackboard/types';
import { NodeActionMenu, type NodeAction } from './NodeActionMenu';
import NodeIcon from './NodeIcon';
import { getBlendModeLabel } from './nodeVisualHelpers';

export function DirectMergeInlineNode({
  mergeNode,
  isSelected,
  onSelect,
  actions,
}: {
  mergeNode: AnyNode;
  isSelected: boolean;
  onSelect: (event: React.MouseEvent, nodeId: string) => void;
  actions: NodeAction[];
}) {
  return (
    <>
      <div
        className="pointer-events-none absolute right-28 top-1/2 h-px w-4 -translate-y-1/2 bg-gray-400/30"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute right-[6.75rem] top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full border border-gray-400/40 bg-gray-900"
        aria-hidden="true"
      />
      <div
        onClick={(event) => {
          event.stopPropagation();
          onSelect(event, mergeNode.id);
        }}
        className={`absolute right-0 top-1/2 flex w-28 -translate-y-1/2 items-center gap-1 rounded-md border px-1.5 py-1 text-[10px] transition-colors ${
          isSelected
            ? 'border-primary-400/70 bg-primary-950/45 text-primary-100'
            : 'border-white/10 bg-gray-900/45 text-gray-400 hover:border-gray-600 hover:bg-gray-900/70'
        }`}
        title={`Merge: ${getBlendModeLabel((mergeNode as { operator?: BlendMode }).operator)}`}
      >
        <NodeIcon node={mergeNode} />
        <span className="min-w-0 flex-1 truncate font-medium uppercase">
          {getBlendModeLabel((mergeNode as { operator?: BlendMode }).operator)}
        </span>
        <NodeActionMenu actions={actions} />
      </div>
    </>
  );
}
