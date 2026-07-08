import { AnyNode, ImageSequenceNode, MediaSourceNode, NodeType } from '@blackboard/types';
import { nodeFlags } from '@/nodes/helpers';

export const MEDIA_SOURCE_UPSTREAM = '__media_source_upstream__';

export interface MediaSourceOption {
  value: string;
  label: string;
  kind: 'upstream' | 'media-source' | 'image-sequence';
  description: string;
}

export const isMediaSourceNode = (node: AnyNode): node is MediaSourceNode | ImageSequenceNode =>
  node.type === NodeType.MEDIA_SOURCE || node.type === NodeType.IMAGE_SEQUENCE;

export const isUpstreamMediaSourceId = (sourceId: string): boolean =>
  sourceId === MEDIA_SOURCE_UPSTREAM;

export const getUpstreamSourceNodes = (nodes: AnyNode[], currentNodeId: string): AnyNode[] => {
  const currentNodeIndex = nodes.findIndex((node) => node.id === currentNodeId);
  if (currentNodeIndex <= 0) {
    return [];
  }

  const upstreamNodes = nodes.slice(0, currentNodeIndex);
  return upstreamNodes.some((node) => !nodeFlags(node.type).isSceneLike) ? upstreamNodes : [];
};

export const getUpstreamMediaSourceNode = (
  nodes: AnyNode[],
  currentNodeId: string,
): MediaSourceNode | ImageSequenceNode | null => {
  const upstreamNodes = getUpstreamSourceNodes(nodes, currentNodeId).filter(
    (node) => !nodeFlags(node.type).isSceneLike,
  );

  if (upstreamNodes.length !== 1) {
    return null;
  }

  const [upstreamNode] = upstreamNodes;
  return isMediaSourceNode(upstreamNode) ? upstreamNode : null;
};

export const getMediaSourceOptions = (
  nodes: AnyNode[],
  currentNodeId: string,
): MediaSourceOption[] => {
  const options: MediaSourceOption[] = [];

  if (getUpstreamSourceNodes(nodes, currentNodeId).length > 0) {
    options.push({
      value: MEDIA_SOURCE_UPSTREAM,
      label: 'Upstream Result',
      kind: 'upstream',
      description: 'Composited upstream flow',
    });
  }

  options.push(
    ...nodes
      .filter((node) => node.id !== currentNodeId && isMediaSourceNode(node))
      .map<MediaSourceOption>((node) => ({
        value: node.id,
        label: node.name,
        kind: node.type === NodeType.IMAGE_SEQUENCE ? 'image-sequence' : 'media-source',
        description:
          node.type === NodeType.IMAGE_SEQUENCE ? 'Image sequence node' : 'Media source node',
      })),
  );

  return options;
};

export const getDefaultMediaSourceId = (nodes: AnyNode[], currentNodeId: string): string => {
  if (getUpstreamSourceNodes(nodes, currentNodeId).length > 0) {
    return MEDIA_SOURCE_UPSTREAM;
  }

  const currentNodeIndex = nodes.findIndex((node) => node.id === currentNodeId);

  for (let index = currentNodeIndex - 1; index >= 0; index -= 1) {
    const candidate = nodes[index];
    if (isMediaSourceNode(candidate)) {
      return candidate.id;
    }
  }

  return '';
};

export const isValidMediaSourceId = (
  nodes: AnyNode[],
  currentNodeId: string,
  sourceId: string,
): boolean => {
  if (!sourceId) {
    return false;
  }

  if (isUpstreamMediaSourceId(sourceId)) {
    return getUpstreamSourceNodes(nodes, currentNodeId).length > 0;
  }

  return nodes.some(
    (node) => node.id !== currentNodeId && node.id === sourceId && isMediaSourceNode(node),
  );
};

export const getMediaSourceLabel = (
  nodes: AnyNode[],
  currentNodeId: string,
  sourceId: string,
): string | null =>
  getMediaSourceOptions(nodes, currentNodeId).find((option) => option.value === sourceId)?.label ??
  null;
