import { describe, expect, it } from 'vitest';
import type { FlowEdge } from '@blackboard/types';
import {
  collectUpstreamEdgeIds,
  collectUpstreamEdgeIdsForNodes,
  collectUpstreamNodeIds,
  getPrimaryPipelineNodeIds,
} from './flowTopology';

const edges: FlowEdge[] = [
  {
    id: 'plate-grade',
    sourceNodeId: 'plate',
    sourcePort: 'output',
    targetNodeId: 'grade',
    targetPort: 'pipe',
  },
  {
    id: 'matte-merge',
    sourceNodeId: 'matte',
    sourcePort: 'output',
    targetNodeId: 'merge',
    targetPort: 'source',
  },
  {
    id: 'grade-merge',
    sourceNodeId: 'grade',
    sourcePort: 'output',
    targetNodeId: 'merge',
    targetPort: 'pipe',
  },
  {
    id: 'merge-output',
    sourceNodeId: 'merge',
    sourcePort: 'output',
    targetNodeId: 'output',
    targetPort: 'pipe',
  },
];

describe('flow topology', () => {
  it('collects every upstream branch from canonical edges', () => {
    expect(collectUpstreamEdgeIds(edges, 'merge')).toEqual(
      new Set(['plate-grade', 'matte-merge', 'grade-merge']),
    );
    expect(collectUpstreamNodeIds(edges, 'merge')).toEqual(new Set(['plate', 'grade', 'matte']));
  });

  it('unifies upstream paths for multiple viewer targets', () => {
    expect(collectUpstreamEdgeIdsForNodes(edges, ['grade', 'merge'])).toEqual(
      new Set(['plate-grade', 'matte-merge', 'grade-merge']),
    );
  });

  it('returns only the primary pipe chain in source-to-output order', () => {
    const flow = {
      id: 'root',
      name: 'Root',
      nodes: [],
      edges,
      stacks: [],
      outputNodeId: 'output',
    };

    expect(getPrimaryPipelineNodeIds(flow)).toEqual(['plate', 'grade', 'merge']);
  });

  it('terminates malformed cycles without including the target as its own upstream node', () => {
    const cyclicEdges: FlowEdge[] = [
      {
        id: 'a-b',
        sourceNodeId: 'a',
        sourcePort: 'output',
        targetNodeId: 'b',
        targetPort: 'pipe',
      },
      {
        id: 'b-a',
        sourceNodeId: 'b',
        sourcePort: 'output',
        targetNodeId: 'a',
        targetPort: 'pipe',
      },
    ];

    expect(collectUpstreamNodeIds(cyclicEdges, 'a')).toEqual(new Set(['b']));
  });
});
