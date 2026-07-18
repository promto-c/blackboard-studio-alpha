import type { AnyNode, Flow, FlowEdge } from '@blackboard/types';
import { getInputPorts } from '@/nodes/helpers';
import { getFlowEdgeId } from '@/state/editor/flowModel';
import { participatesInPipeline, usesPipelineInput } from '@/utils/nodePredicates';
import {
  DEFAULT_OUTPUT_PORT,
  getInputEdge,
  getPrimaryPipelineNodeIds,
  PIPE_INPUT_PORT,
} from '@/utils/flowTopology';

const acceptsPipelineInput = (node: AnyNode): boolean =>
  usesPipelineInput(node.type) || getInputPorts(node).some((port) => port.name === PIPE_INPUT_PORT);

const getPrimaryPipelineEdgeIds = (flow: Flow): ReadonlySet<string> => {
  const edgeIds = new Set<string>();
  const visitedNodeIds = new Set<string>([flow.outputNodeId]);
  let targetNodeId = flow.outputNodeId;

  while (true) {
    const edge = getInputEdge(flow, targetNodeId, PIPE_INPUT_PORT);
    if (!edge || visitedNodeIds.has(edge.sourceNodeId)) break;
    edgeIds.add(edge.id);
    visitedNodeIds.add(edge.sourceNodeId);
    targetNodeId = edge.sourceNodeId;
  }

  return edgeIds;
};

const createPipelineEdge = (sourceNodeId: string, targetNodeId: string): FlowEdge => ({
  id: getFlowEdgeId(sourceNodeId, targetNodeId, PIPE_INPUT_PORT),
  sourceNodeId,
  sourcePort: DEFAULT_OUTPUT_PORT,
  targetNodeId,
  targetPort: PIPE_INPUT_PORT,
});

/**
 * Materializes the default serial image pipeline as real graph edges.
 *
 * This is intentionally a creation helper, not a read-time fallback. Once a
 * flow exists, its edges are the complete and only source of connection truth.
 */
export const connectDefaultPipeline = (flow: Flow, orderedNodes: readonly AnyNode[]): Flow => {
  const pipelineNodes = orderedNodes.filter((node) => participatesInPipeline(node.type));

  const edges: FlowEdge[] = [...flow.edges];
  let previousNodeId: string | null = null;

  for (const node of pipelineNodes) {
    if (
      previousNodeId &&
      acceptsPipelineInput(node) &&
      !getInputEdge({ ...flow, edges }, node.id, PIPE_INPUT_PORT)
    ) {
      edges.push({
        id: getFlowEdgeId(previousNodeId, node.id, PIPE_INPUT_PORT),
        sourceNodeId: previousNodeId,
        sourcePort: DEFAULT_OUTPUT_PORT,
        targetNodeId: node.id,
        targetPort: PIPE_INPUT_PORT,
      });
    }
    previousNodeId = node.id;
  }

  if (previousNodeId && !getInputEdge({ ...flow, edges }, flow.outputNodeId, PIPE_INPUT_PORT)) {
    edges.push({
      id: getFlowEdgeId(previousNodeId, flow.outputNodeId, PIPE_INPUT_PORT),
      sourceNodeId: previousNodeId,
      sourcePort: DEFAULT_OUTPUT_PORT,
      targetNodeId: flow.outputNodeId,
      targetPort: PIPE_INPUT_PORT,
    });
  }

  return edges.length === flow.edges.length ? flow : { ...flow, edges };
};

/**
 * Reorders the existing primary pipeline to match the current list order.
 * Only nodes that were already connected to the output participate;
 * disconnected nodes and branch inputs remain untouched.
 */
export const rewirePrimaryPipeline = (
  previousFlow: Flow,
  nextFlow: Flow,
  orderedNodes: readonly AnyNode[],
): Flow => {
  const previousOutputEdge = getInputEdge(previousFlow, previousFlow.outputNodeId, PIPE_INPUT_PORT);
  if (!previousOutputEdge) return nextFlow;

  const pipelineNodeIds = new Set(getPrimaryPipelineNodeIds(previousFlow));
  const nextPipelineNodes = orderedNodes.filter(
    (node) => pipelineNodeIds.has(node.id) && participatesInPipeline(node.type),
  );

  const primaryEdgeIds = getPrimaryPipelineEdgeIds(previousFlow);
  const primaryTargetIds = new Set(nextPipelineNodes.map((node) => node.id));
  primaryTargetIds.add(nextFlow.outputNodeId);

  const edges = nextFlow.edges.filter(
    (edge) =>
      !primaryEdgeIds.has(edge.id) &&
      !(edge.targetPort === PIPE_INPUT_PORT && primaryTargetIds.has(edge.targetNodeId)),
  );

  let pipelineTailId: string | null = null;
  for (const node of nextPipelineNodes) {
    if (pipelineTailId && acceptsPipelineInput(node)) {
      edges.push(createPipelineEdge(pipelineTailId, node.id));
    }
    pipelineTailId = node.id;
  }

  if (pipelineTailId) {
    edges.push(createPipelineEdge(pipelineTailId, nextFlow.outputNodeId));
  }

  return { ...nextFlow, edges };
};
