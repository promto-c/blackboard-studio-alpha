import { describe, expect, it } from 'vitest';
import { NodeKind, NodeType, type AnyNode, type Flow } from '@blackboard/types';
import { getAllProjectNodes } from './flowModel';

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
