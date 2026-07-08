import type { AnyNode, Flow, OutputNode, OutputTechnicalChannel } from '@blackboard/types';

const OUTPUT_TECHNICAL_CHANNEL_PORT_PREFIX = 'technical:';

export const getOutputTechnicalChannelPort = (channelId: string): string =>
  `${OUTPUT_TECHNICAL_CHANNEL_PORT_PREFIX}${channelId}`;

export const isOutputTechnicalChannelPort = (portName: string): boolean =>
  portName.startsWith(OUTPUT_TECHNICAL_CHANNEL_PORT_PREFIX);

export interface ConnectedOutputTechnicalChannel extends OutputTechnicalChannel {
  nodeId: string;
  sourcePort: string;
}

export const getConnectedOutputTechnicalChannels = (
  flow: Flow | null,
): ConnectedOutputTechnicalChannel[] => {
  if (!flow) return [];
  const outputNode = flow.nodes.find((node) => node.id === flow.outputNodeId) as
    | OutputNode
    | undefined;
  const channels = outputNode?.technicalChannels ?? [];

  return channels.flatMap((channel) => {
    const edge = flow.edges.find(
      (candidate) =>
        candidate.targetNodeId === flow.outputNodeId &&
        candidate.targetPort === getOutputTechnicalChannelPort(channel.id),
    );
    return edge
      ? [
          {
            ...channel,
            nodeId: edge.sourceNodeId,
            sourcePort: edge.sourcePort || 'output',
          },
        ]
      : [];
  });
};

export const getOutputNodeTechnicalChannels = (
  flow: Flow | null,
): readonly OutputTechnicalChannel[] => {
  if (!flow) return [];
  const outputNode = flow.nodes.find((node) => node.id === flow.outputNodeId) as
    | (AnyNode & OutputNode)
    | undefined;
  return outputNode?.technicalChannels ?? [];
};
