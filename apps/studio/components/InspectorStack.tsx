import React from 'react';
import { AnyNode } from '@blackboard/types';

export interface InspectorStackProps {
  selectedNode: AnyNode | undefined;
  selectedNodeId: string | null;
  nodes: AnyNode[];
  emptyState: React.ReactNode;
  isOutputSelected?: boolean;
  outputContent?: React.ReactNode;
  isMergeSelected?: boolean;
  mergeContent?: React.ReactNode;
  renderNode: (node: AnyNode) => React.ReactNode;
  wrapSingle?: boolean;
  stackClassName?: string;
  getCardClassName: (node: AnyNode, isSelected: boolean) => string;
  renderCardHeader?: (node: AnyNode) => React.ReactNode;
}

const InspectorStack: React.FC<InspectorStackProps> = ({
  selectedNode,
  selectedNodeId,
  nodes,
  emptyState,
  isOutputSelected = false,
  outputContent = null,
  isMergeSelected = false,
  mergeContent = null,
  renderNode,
  wrapSingle = false,
  stackClassName = 'space-y-2',
  getCardClassName,
  renderCardHeader,
}) => {
  if (isOutputSelected) {
    return <>{outputContent}</>;
  }

  if (isMergeSelected) {
    return <>{mergeContent}</>;
  }

  if (!selectedNode) {
    return <>{emptyState}</>;
  }

  const shouldWrapNodes = wrapSingle || nodes.length > 1;
  if (!shouldWrapNodes) {
    return nodes[0] ? <>{renderNode(nodes[0])}</> : <>{renderNode(selectedNode)}</>;
  }

  return (
    <div className={stackClassName}>
      {nodes.map((node) => (
        <div key={node.id} className={getCardClassName(node, node.id === selectedNodeId)}>
          {renderCardHeader ? renderCardHeader(node) : null}
          {renderNode(node)}
        </div>
      ))}
    </div>
  );
};

export default InspectorStack;
