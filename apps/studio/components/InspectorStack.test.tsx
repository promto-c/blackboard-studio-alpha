// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NodeType, type AnyNode } from '@blackboard/types';
import InspectorStack from './InspectorStack';

const createNode = (id: string, name: string): AnyNode =>
  ({
    id,
    name,
    type: NodeType.BLUR,
    visible: true,
  }) as AnyNode;

describe('InspectorStack', () => {
  it('renders output content when output is selected', () => {
    render(
      <InspectorStack
        selectedNode={undefined}
        selectedNodeId={null}
        nodes={[]}
        isOutputSelected
        outputContent={<div>Output Content</div>}
        emptyState={<div>Empty</div>}
        renderNode={(node) => <div>{node.name}</div>}
        getCardClassName={() => 'card'}
      />,
    );

    expect(screen.queryByText('Output Content')).not.toBeNull();
    expect(screen.queryByText('Empty')).toBeNull();
  });

  it('renders merge content when merge is selected', () => {
    render(
      <InspectorStack
        selectedNode={undefined}
        selectedNodeId={null}
        nodes={[]}
        isMergeSelected
        mergeContent={<div>Merge Content</div>}
        emptyState={<div>Empty</div>}
        renderNode={(node) => <div>{node.name}</div>}
        getCardClassName={() => 'card'}
      />,
    );

    expect(screen.queryByText('Merge Content')).not.toBeNull();
  });

  it('renders empty state when nothing is selected', () => {
    render(
      <InspectorStack
        selectedNode={undefined}
        selectedNodeId={null}
        nodes={[]}
        emptyState={<div>Empty</div>}
        renderNode={(node) => <div>{node.name}</div>}
        getCardClassName={() => 'card'}
      />,
    );

    expect(screen.queryByText('Empty')).not.toBeNull();
  });

  it('preserves selected styling and headers for wrapped stacks', () => {
    const firstNode = createNode('node-1', 'Node One');
    const secondNode = createNode('node-2', 'Node Two');

    render(
      <InspectorStack
        selectedNode={firstNode}
        selectedNodeId={secondNode.id}
        nodes={[firstNode, secondNode]}
        emptyState={<div>Empty</div>}
        renderNode={(node) => <div>{node.name} Body</div>}
        renderCardHeader={(node) => <div>{node.name} Header</div>}
        getCardClassName={(_node, isSelected) => (isSelected ? 'card selected' : 'card')}
      />,
    );

    expect(screen.queryByText('Node One Header')).not.toBeNull();
    expect(screen.queryByText('Node Two Header')).not.toBeNull();
    expect(screen.getByText('Node Two Body').closest('.selected')).not.toBeNull();
  });
});
