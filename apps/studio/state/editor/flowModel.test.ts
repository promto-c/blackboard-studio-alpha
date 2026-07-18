import { describe, expect, it } from 'vitest';
import { NodeKind, NodeType, type AnyNode, type Flow } from '@blackboard/types';
import { buildFlowFromNodes, getAllProjectNodes, getOrderedNodesFromFlow } from './flowModel';

const node = (id: string): AnyNode =>
  ({
    id,
    kind: NodeKind.EFFECT,
    type: NodeType.NOTE,
    name: id,
    enabled: true,
  }) as AnyNode;

const flow = (id: string, nodes: AnyNode[]): Flow => ({
  id,
  name: id,
  nodes,
  edges: [],
  stacks: [],
  outputNodeId: 'output',
});

describe('getAllProjectNodes', () => {
  it('collects canonical nodes from every project flow in flow order', () => {
    const nodes = getAllProjectNodes({
      root: flow('root', [node('scene'), node('group')]),
      child: flow('child', [node('input'), node('paint')]),
    });

    expect(nodes.map((entry) => entry.id)).toEqual(['scene', 'group', 'input', 'paint']);
  });
});

describe('stack presentation projection', () => {
  it('stores compaction only in Flow.stacks and never on canonical nodes', () => {
    const base = node('base');
    const compacted = { ...node('compacted'), stacked: true } as unknown as AnyNode;
    const projectFlow = buildFlowFromNodes([base, compacted]);

    expect(projectFlow.stacks).toContainEqual(
      expect.objectContaining({ rootNodeId: 'base', nodeIds: ['base', 'compacted'] }),
    );
    expect(projectFlow.nodes.find((entry) => entry.id === 'compacted')).not.toHaveProperty(
      'stacked',
    );
    expect(
      getOrderedNodesFromFlow(projectFlow).find((entry) => entry.id === 'compacted'),
    ).toHaveProperty('stacked', true);
  });
});
