import { type AnyNode, type PaintNode, NodeType } from '@blackboard/types';
import { getAnimatableProperties } from '@/effects/effectAnimation';
import {
  getPaintTextureCacheKey,
  paintNodeHasFrameBoundVisibility,
  paintNodeUsesCloneSourceAtFrame,
  paintNodeUsesDynamicCloneSourceAtFrame,
} from './paintRaster';

const hashString = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
};

export const getUpstreamCloneDependencyKey = (nodes: AnyNode[], paintNodeId: string): string => {
  const paintNodeIndex = nodes.findIndex((node) => node.id === paintNodeId);
  if (paintNodeIndex <= 0) {
    return 'root';
  }

  return hashString(JSON.stringify(nodes.slice(0, paintNodeIndex)));
};

const animatableNumberVariesByFrame = (value: number | { frame: number; value: number }[]) =>
  Array.isArray(value) && value.length > 1;

const nodeHasIntrinsicFrameVariance = (node: AnyNode): boolean => {
  if (node.type === NodeType.VIDEO) {
    return Boolean(node.src);
  }

  if (node.type === NodeType.IMAGE_SEQUENCE) {
    return (node.frames?.length ?? 0) > 1;
  }

  if (node.type === NodeType.PAINT) {
    return paintNodeHasFrameBoundVisibility(node);
  }

  if (
    node.type === NodeType.SCENE ||
    node.type === NodeType.OUTPUT ||
    node.type === NodeType.GROUP
  ) {
    return false;
  }

  return getAnimatableProperties(node).some((property) =>
    animatableNumberVariesByFrame(property.prop),
  );
};

const upstreamNodesVaryByFrame = (nodes: AnyNode[]): boolean => {
  for (const node of nodes) {
    if (node.visible === false) {
      continue;
    }

    if (nodeHasIntrinsicFrameVariance(node)) {
      return true;
    }
  }

  return false;
};

export const getPaintTextureCommittedState = ({
  node,
  nodes,
  frame,
  width,
  height,
}: {
  node: Pick<PaintNode, 'id' | 'layers' | 'strokes'>;
  nodes: AnyNode[];
  frame: number;
  width: number;
  height: number;
}): { committedKey: string; requiresDynamicCloneSource: boolean } => {
  const paintNodeIndex = nodes.findIndex((candidate) => candidate.id === node.id);
  const upstreamNodes = paintNodeIndex > 0 ? nodes.slice(0, paintNodeIndex) : [];
  const upstreamVariesByFrame = upstreamNodesVaryByFrame(upstreamNodes);
  const requiresDynamicCloneSource =
    (paintNodeUsesCloneSourceAtFrame(node, frame) && upstreamVariesByFrame) ||
    paintNodeUsesDynamicCloneSourceAtFrame(node, frame);
  const baseKey = getPaintTextureCacheKey(node, frame, width, height, {
    forceFrame: requiresDynamicCloneSource,
  });

  return {
    committedKey: requiresDynamicCloneSource
      ? `${baseKey}:upstream:${getUpstreamCloneDependencyKey(nodes, node.id)}`
      : baseKey,
    requiresDynamicCloneSource,
  };
};
