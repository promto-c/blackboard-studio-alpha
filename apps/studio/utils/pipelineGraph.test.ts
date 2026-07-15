import { describe, expect, it } from 'vitest';
import { NodeType, type AnyNode, type FlowEdge } from '@blackboard/types';
import {
  buildFlowFromNodes,
  getOrderedNodesFromFlow,
  replaceFlowNodes,
  ROOT_FLOW_ID,
} from '@/state/editor/flowModel';
import { getPrimaryPipelineNodeIds } from '@/utils/flowTopology';
import { connectDefaultPipeline, rewirePrimaryPipeline } from '@/utils/pipelineGraph';

const scene = (): AnyNode =>
  ({ id: 'scene', type: NodeType.SCENE, name: 'Scene', enabled: true }) as AnyNode;

const image = (id: string): AnyNode =>
  ({ id, type: NodeType.MEDIA_SOURCE, name: id, enabled: true }) as AnyNode;

const adjustment = (id: string, stacked = false): AnyNode =>
  ({ id, type: NodeType.BLUR, name: id, enabled: true, stacked }) as AnyNode;

const merge = (id: string): AnyNode =>
  ({ id, type: NodeType.MERGE, name: id, enabled: true }) as AnyNode;

const createFlow = (nodes: AnyNode[]) =>
  connectDefaultPipeline(buildFlowFromNodes(nodes, ROOT_FLOW_ID, 'Root Flow'), nodes);

const rebuildAndRewire = (previousFlow: ReturnType<typeof createFlow>, nodes: AnyNode[]) => {
  const rebuilt = replaceFlowNodes({ [previousFlow.id]: previousFlow }, previousFlow.id, nodes)[
    previousFlow.id
  ];
  return rewirePrimaryPipeline(previousFlow, rebuilt, nodes);
};

const hasEdge = (
  edges: readonly FlowEdge[],
  sourceNodeId: string,
  targetNodeId: string,
  targetPort = 'pipe',
) =>
  edges.some(
    (edge) =>
      edge.sourceNodeId === sourceNodeId &&
      edge.targetNodeId === targetNodeId &&
      edge.targetPort === targetPort,
  );

describe('rewirePrimaryPipeline', () => {
  it('rewrites the real pipe chain to match reordered pipeline roots', () => {
    const first = adjustment('first');
    const second = adjustment('second');
    const previousFlow = createFlow([scene(), image('image'), first, second]);
    const projectedNodes = getOrderedNodesFromFlow(previousFlow);
    const reorderedNodes = [
      projectedNodes[0],
      projectedNodes[1],
      projectedNodes[3],
      projectedNodes[2],
    ];

    const nextFlow = rebuildAndRewire(previousFlow, reorderedNodes);

    expect(getPrimaryPipelineNodeIds(nextFlow)).toEqual(['image', 'second', 'first']);
  });

  it('collapses and restores pipe edges when an adjustment is stacked and unstacked', () => {
    const previousFlow = createFlow([
      scene(),
      image('image'),
      adjustment('stacked'),
      adjustment('tail'),
    ]);
    const stackedNodes = getOrderedNodesFromFlow(previousFlow).map((node) =>
      node.id === 'stacked' ? ({ ...node, stacked: true } as AnyNode) : node,
    );

    const stackedFlow = rebuildAndRewire(previousFlow, stackedNodes);

    expect(getPrimaryPipelineNodeIds(stackedFlow)).toEqual(['image', 'tail']);
    expect(hasEdge(stackedFlow.edges, 'image', 'stacked')).toBe(false);
    expect(hasEdge(stackedFlow.edges, 'image', 'tail')).toBe(true);

    const unstackedNodes = getOrderedNodesFromFlow(stackedFlow).map((node) =>
      node.id === 'stacked' ? ({ ...node, stacked: false } as AnyNode) : node,
    );
    const unstackedFlow = rebuildAndRewire(stackedFlow, unstackedNodes);

    expect(getPrimaryPipelineNodeIds(unstackedFlow)).toEqual(['image', 'stacked', 'tail']);
  });

  it('keeps disconnected nodes and auxiliary inputs disconnected from the output chain', () => {
    const connectedFlow = createFlow([scene(), image('image'), adjustment('connected')]);
    const withFloatingNode = rebuildAndRewire(connectedFlow, [
      ...getOrderedNodesFromFlow(connectedFlow),
      adjustment('floating'),
    ]);
    const previousFlow = {
      ...withFloatingNode,
      edges: [
        ...withFloatingNode.edges,
        {
          id: 'edge_floating_connected_mask',
          sourceNodeId: 'floating',
          sourcePort: 'output',
          targetNodeId: 'connected',
          targetPort: 'mask',
        },
      ],
    };
    const projectedNodes = getOrderedNodesFromFlow(previousFlow);
    const reorderedNodes = [
      projectedNodes.find((node) => node.id === 'scene')!,
      projectedNodes.find((node) => node.id === 'image')!,
      projectedNodes.find((node) => node.id === 'floating')!,
      projectedNodes.find((node) => node.id === 'connected')!,
    ];

    const nextFlow = rebuildAndRewire(previousFlow, reorderedNodes);

    expect(getPrimaryPipelineNodeIds(nextFlow)).toEqual(['image', 'connected']);
    expect(nextFlow.edges).toContainEqual(
      expect.objectContaining({
        sourceNodeId: 'floating',
        targetNodeId: 'connected',
        targetPort: 'mask',
      }),
    );
    expect(hasEdge(nextFlow.edges, 'floating', 'connected')).toBe(false);
  });
});

describe('connectDefaultPipeline', () => {
  it('uses registry-declared pipe ports as part of the materialized chain', () => {
    const nextFlow = createFlow([scene(), image('image'), merge('merge')]);

    expect(getPrimaryPipelineNodeIds(nextFlow)).toEqual(['image', 'merge']);
  });
});
