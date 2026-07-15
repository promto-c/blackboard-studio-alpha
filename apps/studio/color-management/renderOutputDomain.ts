import type { AnyNode, Flow, RenderOutputDomain, RenderSettings } from '@blackboard/types';
import {
  isTechnicalProcessingDomain,
  resolveRendererNodeInputDomain,
  resolveRendererNodeOutputPort,
  resolveRendererNodeProcessingDomain,
  type NodeRegistryLike,
} from '@blackboard/renderer';
import { OUTPUT_NODE_ID } from '@/state/editor/flowModel';
import { getInputEdge, getOutputInputEdge, PIPE_INPUT_PORT } from '@/utils/flowTopology';

interface RenderOutputEndpoint {
  nodeId: string;
  port: string;
  /** The endpoint is entering an ordinary RGBA image port. */
  expandsComponentToColor?: boolean;
}

const getOutputEndpoint = (
  flow: Flow | null,
  viewerNodeId?: string | null,
): RenderOutputEndpoint | null => {
  if (viewerNodeId && viewerNodeId !== OUTPUT_NODE_ID) {
    return { nodeId: viewerNodeId, port: 'output' };
  }

  const outputEdge = getOutputInputEdge(flow);
  return outputEdge
    ? {
        nodeId: outputEdge.sourceNodeId,
        port: outputEdge.sourcePort || 'output',
        expandsComponentToColor: true,
      }
    : null;
};

const getPipeInputEndpoint = (node: AnyNode, flow: Flow | null): RenderOutputEndpoint | null => {
  const edge = getInputEdge(flow, node.id, PIPE_INPUT_PORT);
  return edge ? { nodeId: edge.sourceNodeId, port: edge.sourcePort || 'output' } : null;
};

const resolveEndpointDomain = (
  nodesById: ReadonlyMap<string, AnyNode>,
  flow: Flow | null,
  endpoint: RenderOutputEndpoint,
  visitedNodeIds: Set<string>,
  nodeRegistry: NodeRegistryLike,
): RenderOutputDomain => {
  const node = nodesById.get(endpoint.nodeId);
  if (!node || visitedNodeIds.has(node.id)) return { kind: 'color' };
  visitedNodeIds.add(node.id);

  const definition = nodeRegistry.get(node.type);
  const outputPort = definition
    ? resolveRendererNodeOutputPort(definition, node, endpoint.port)
    : undefined;
  if (endpoint.expandsComponentToColor && outputPort?.channel) {
    return {
      kind: 'color',
      sourceNodeId: node.id,
      sourcePort: endpoint.port,
    };
  }
  const processingDomain = definition
    ? resolveRendererNodeProcessingDomain(definition, node, endpoint.port)
    : 'scene_linear';
  if (isTechnicalProcessingDomain(processingDomain)) {
    return {
      kind: 'data',
      sourceNodeId: node.id,
      sourcePort: endpoint.port,
      ...(outputPort?.dataSemantic ? { semantic: outputPort.dataSemantic } : {}),
    };
  }

  if (endpoint.port === 'output') {
    const pipeInput = getPipeInputEndpoint(node, flow);
    if (pipeInput) {
      const inputDomain = definition
        ? resolveRendererNodeInputDomain(definition, node, 'pipe')
        : processingDomain;
      return resolveEndpointDomain(
        nodesById,
        flow,
        {
          ...pipeInput,
          expandsComponentToColor: !inputDomain || !isTechnicalProcessingDomain(inputDomain),
        },
        visitedNodeIds,
        nodeRegistry,
      );
    }
  }

  return { kind: 'color' };
};

export const resolveRenderOutputDomain = ({
  nodes,
  flow,
  viewerNodeId,
  nodeRegistry,
}: {
  nodes: readonly AnyNode[];
  flow: Flow | null;
  viewerNodeId?: string | null;
  nodeRegistry: NodeRegistryLike;
}): RenderOutputDomain => {
  const endpoint = getOutputEndpoint(flow, viewerNodeId);
  if (!endpoint) return { kind: 'color' };
  return resolveEndpointDomain(
    new Map(nodes.map((node) => [node.id, node])),
    flow,
    endpoint,
    new Set(),
    nodeRegistry,
  );
};

export const getTechnicalOutputFormatIssue = (
  domain: RenderOutputDomain,
  format: RenderSettings['format'],
): string | null =>
  domain.kind === 'data' && format !== 'image/x-exr'
    ? 'Technical data output requires OpenEXR to preserve unclamped floating-point values.'
    : null;

const TECHNICAL_CHANNEL_NAMES = {
  alpha: 'A',
  mask: 'mask.Y',
  depth: 'Z',
  normal: 'N',
  motion_vector: 'motion',
  uv: 'UV',
  position: 'P',
  id: 'ID',
  cryptomatte: 'crypto',
  material_property: 'material',
} as const;

export const getTechnicalOutputChannelName = (domain: RenderOutputDomain): string | null => {
  if (domain.kind !== 'data') return null;
  if (domain.semantic) return TECHNICAL_CHANNEL_NAMES[domain.semantic];
  return domain.sourcePort !== 'output' ? domain.sourcePort : 'Y';
};
