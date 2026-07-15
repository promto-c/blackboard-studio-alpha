import type {
  AnyNode,
  ColorProcessingDomain,
  DataChannelSemantic,
  RgbaChannel,
} from '@blackboard/types';
import type { RendererNodeEntry } from './types';

const SEMANTIC_DOMAINS: Record<DataChannelSemantic, ColorProcessingDomain> = {
  alpha: 'alpha',
  mask: 'alpha',
  depth: 'depth',
  normal: 'vector',
  motion_vector: 'vector',
  uv: 'vector',
  position: 'vector',
  id: 'data',
  cryptomatte: 'data',
  material_property: 'data',
};

export const getDataSemanticProcessingDomain = (
  semantic: DataChannelSemantic,
): ColorProcessingDomain => SEMANTIC_DOMAINS[semantic];

export const isTechnicalProcessingDomain = (domain: ColorProcessingDomain): boolean =>
  domain === 'data' || domain === 'alpha' || domain === 'vector' || domain === 'depth';

export const resolveRendererNodeOutputPort = (
  definition: RendererNodeEntry,
  node: AnyNode,
  outputPortName: string,
) => {
  const outputPorts =
    typeof definition.outputPorts === 'function'
      ? definition.outputPorts(node)
      : definition.outputPorts;
  return outputPorts?.find((port) => port.name === outputPortName);
};

export const resolveRendererNodeInputPort = (
  definition: RendererNodeEntry,
  node: AnyNode,
  inputPortName: string,
) => {
  const inputPorts =
    typeof definition.inputPorts === 'function'
      ? definition.inputPorts(node)
      : definition.inputPorts;
  return inputPorts?.find((port) => port.name === inputPortName);
};

export const resolveRendererNodeProcessingDomain = (
  definition: RendererNodeEntry,
  node: AnyNode,
  outputPortName = 'output',
): ColorProcessingDomain => {
  const outputPort = resolveRendererNodeOutputPort(definition, node, outputPortName);
  if (outputPort?.processingDomain) return outputPort.processingDomain;
  if (outputPort?.dataSemantic) {
    return getDataSemanticProcessingDomain(outputPort.dataSemantic);
  }
  if (definition.mediaDescriptor?.isData?.(node)) return 'data';
  return typeof definition.processingDomain === 'function'
    ? definition.processingDomain(node)
    : definition.processingDomain;
};

export const resolveRendererNodeInputDomain = (
  definition: RendererNodeEntry,
  node: AnyNode,
  inputPortName: string,
): ColorProcessingDomain | null => {
  if (inputPortName === 'pipe' && definition.primaryInputDomain) {
    return typeof definition.primaryInputDomain === 'function'
      ? definition.primaryInputDomain(node)
      : definition.primaryInputDomain;
  }
  const inputPort = resolveRendererNodeInputPort(definition, node, inputPortName);
  if (inputPort?.processingDomain) return inputPort.processingDomain;
  if (inputPort?.dataSemantic) return getDataSemanticProcessingDomain(inputPort.dataSemantic);
  if (inputPortName === 'pipe') {
    return resolveRendererNodeProcessingDomain(definition, node);
  }
  return null;
};

export const areProcessingDomainsCompatible = (
  source: ColorProcessingDomain,
  target: ColorProcessingDomain | null,
  channels?: {
    sourceChannel?: RgbaChannel;
    targetChannel?: RgbaChannel;
  },
): boolean => {
  if (!target || source === target) return true;
  // Channel-aware ports are explicit numeric packing boundaries. A scalar
  // output expands into its named RGBA component when entering an image port;
  // an image feeding a scalar input is sampled from that input's component.
  if (channels?.sourceChannel && !isTechnicalProcessingDomain(target)) return true;
  if (channels?.targetChannel && !isTechnicalProcessingDomain(source)) return true;
  if (
    (source === 'scene_linear' && target === 'log') ||
    (source === 'log' && target === 'scene_linear')
  ) {
    return true;
  }
  if (target === 'data') return isTechnicalProcessingDomain(source);
  if (source === 'data' && isTechnicalProcessingDomain(target)) return true;
  return false;
};

export const assertRendererProcessingDomainsSupported = (
  nodes: readonly AnyNode[],
  getDefinition: (nodeType: string) => RendererNodeEntry | undefined,
): void => {
  nodes.forEach((node) => {
    const definition = getDefinition(node.type);
    if (!definition) return;
    const domain = resolveRendererNodeProcessingDomain(definition, node);
    if (domain === 'display_referred' && definition.renderMode !== 'ocio') {
      throw new Error(
        `${node.name || node.type} declares unsupported "${domain}" processing. ` +
          'An explicit OCIO domain transform is required before rendering.',
      );
    }

    Object.entries(node.inputs ?? {}).forEach(([inputPortName, sourceNodeId]) => {
      const sourceNode = nodes.find((candidate) => candidate.id === sourceNodeId);
      const sourceDefinition = sourceNode ? getDefinition(sourceNode.type) : undefined;
      if (!sourceNode || !sourceDefinition) return;
      const sourcePortName = node.inputSourcePorts?.[inputPortName] ?? 'output';
      const sourceDomain = resolveRendererNodeProcessingDomain(
        sourceDefinition,
        sourceNode,
        sourcePortName,
      );
      const targetDomain = resolveRendererNodeInputDomain(definition, node, inputPortName);
      const sourcePort = resolveRendererNodeOutputPort(
        sourceDefinition,
        sourceNode,
        sourcePortName,
      );
      const targetPort = resolveRendererNodeInputPort(definition, node, inputPortName);
      const canReinterpretColorDomain =
        inputPortName === 'pipe' &&
        definition.primaryInputDomainPolicy === 'reinterpret' &&
        !isTechnicalProcessingDomain(sourceDomain);
      if (
        !canReinterpretColorDomain &&
        !areProcessingDomainsCompatible(sourceDomain, targetDomain, {
          sourceChannel: sourcePort?.channel,
          targetChannel: targetPort?.channel,
        })
      ) {
        throw new Error(
          `Cannot connect "${sourceDomain}" output from ${sourceNode.name || sourceNode.type} ` +
            `to "${targetDomain}" input ${node.name || node.type}.${inputPortName}.`,
        );
      }
    });
  });
};
