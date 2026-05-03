// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NodeType, type AnyNode } from '@blackboard/types';

vi.mock('@/effects/effectRegistry', () => ({
  effectRegistry: {
    get: (type: string) => {
      if (type === NodeType.ROTO) {
        return {
          ItemsComponent: ({ inspectorLevel }: { inspectorLevel?: string }) => (
            <div>Items Panel {inspectorLevel ?? 'none'}</div>
          ),
        };
      }
      return {};
    },
  },
}));

import NodeItemsPanel from './NodeItemsPanel';

const createNode = (type: string): AnyNode =>
  ({
    id: `${type}-1`,
    type,
    name: type,
    visible: true,
  }) as AnyNode;

describe('NodeItemsPanel', () => {
  it('renders nothing when no node is selected', () => {
    const { container } = render(<NodeItemsPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the node type has no items component', () => {
    const { container } = render(<NodeItemsPanel node={createNode(NodeType.BLUR)} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the registered items component with inspector props', () => {
    render(<NodeItemsPanel node={createNode(NodeType.ROTO)} inspectorLevel="shape" />);
    expect(screen.queryByText('Items Panel shape')).not.toBeNull();
  });
});
