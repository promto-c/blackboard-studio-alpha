import type { AnyNode, ColorProcessingDomain } from '@blackboard/types';
import {
  areProcessingDomainsCompatible,
  isTechnicalProcessingDomain,
  resolveRendererNodeInputDomain,
  resolveRendererNodeProcessingDomain,
} from '@blackboard/renderer';
import { nodeRegistry } from '@/nodes/registry';

const PROCESSING_DOMAIN_LABELS: Record<ColorProcessingDomain, string> = {
  scene_linear: 'Scene Linear',
  display_referred: 'Display Referred',
  log: 'Log',
  data: 'Data',
  alpha: 'Alpha',
  vector: 'Vector',
  depth: 'Depth',
};

export const getProcessingDomainLabel = (domain: ColorProcessingDomain): string =>
  PROCESSING_DOMAIN_LABELS[domain];

export const getNodeOutputProcessingDomain = (
  node: AnyNode,
  outputPortName = 'output',
): ColorProcessingDomain => {
  const definition = nodeRegistry.get(node.type);
  return definition
    ? resolveRendererNodeProcessingDomain(definition, node, outputPortName)
    : 'scene_linear';
};

export const getNodeInputProcessingDomain = (
  node: AnyNode,
  inputPortName: string,
): ColorProcessingDomain | null => {
  const definition = nodeRegistry.get(node.type);
  return definition ? resolveRendererNodeInputDomain(definition, node, inputPortName) : null;
};

export const canConnectNodeProcessingDomains = ({
  nodes,
  sourceNodeId,
  sourcePortName,
  targetNodeId,
  targetPortName,
}: {
  nodes: readonly AnyNode[];
  sourceNodeId: string;
  sourcePortName: string;
  targetNodeId: string;
  targetPortName: string;
}): boolean => {
  const sourceNode = nodes.find((node) => node.id === sourceNodeId);
  const targetNode = nodes.find((node) => node.id === targetNodeId);
  if (!sourceNode || !targetNode) return false;
  const sourceDomain = getNodeOutputProcessingDomain(sourceNode, sourcePortName);
  const targetDefinition = nodeRegistry.get(targetNode.type);
  if (
    targetPortName === 'pipe' &&
    targetDefinition?.primaryInputDomainPolicy === 'reinterpret' &&
    !isTechnicalProcessingDomain(sourceDomain)
  ) {
    return true;
  }
  return areProcessingDomainsCompatible(
    sourceDomain,
    getNodeInputProcessingDomain(targetNode, targetPortName),
  );
};
