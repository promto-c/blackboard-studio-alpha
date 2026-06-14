import { AnyNode } from '@blackboard/types';
import { getOutputConnections } from '@/utils/connectionGraph';
import * as Icons from '@blackboard/icons';

interface ConnectionBadgeProps {
  node: AnyNode;
  allNodes: AnyNode[];
  onHoverNodeIds?: (nodeIds: string[]) => void;
  onSelectNode?: (nodeId: string) => void;
}

export function ConnectionBadge({
  node,
  allNodes,
  onHoverNodeIds,
  onSelectNode,
}: ConnectionBadgeProps) {
  const outputs = getOutputConnections(allNodes, node.id).filter(
    (output) => output.portName !== 'pipe',
  );
  const totalConnections = outputs.length;

  if (totalConnections === 0) return null;

  const tooltipLines: string[] = [];
  const relatedNodeIds = new Set<string>();
  for (const { node: consumer, portName } of outputs) {
    relatedNodeIds.add(consumer.id);
    tooltipLines.push(`out \u2192 ${consumer.name}.${portName}`);
  }

  const relatedIds = [...relatedNodeIds];
  const selectableNodeId = relatedIds.length === 1 ? relatedIds[0] : null;
  const isSelectable = Boolean(selectableNodeId && onSelectNode);
  const sharedProps = {
    className: `flex items-center gap-0.5 px-1 py-0.5 rounded bg-primary-900/30 border border-primary-500/20 transition-colors ${
      isSelectable
        ? 'cursor-pointer hover:bg-primary-800/40 hover:border-primary-400/40'
        : 'cursor-default'
    }`,
    title: tooltipLines.join('\n'),
    onMouseEnter: () => onHoverNodeIds?.(relatedIds),
    onMouseLeave: () => onHoverNodeIds?.([]),
  };

  const content = (
    <>
      <Icons.Link className="h-3 w-3 text-primary-400" />
      {totalConnections > 1 && (
        <span className="text-[9px] font-medium text-primary-400">{totalConnections}</span>
      )}
    </>
  );

  if (isSelectable && selectableNodeId) {
    return (
      <button
        type="button"
        {...sharedProps}
        onClick={(event) => {
          event.stopPropagation();
          onSelectNode(selectableNodeId);
        }}
      >
        {content}
      </button>
    );
  }

  return <div {...sharedProps}>{content}</div>;
}
