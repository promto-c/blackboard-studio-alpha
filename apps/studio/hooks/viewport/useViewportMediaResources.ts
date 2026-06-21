import type { AnyNode } from '@blackboard/types';
import type { MediaCacheContext } from '@/nodes/NodeDefinition';
import { getMediaDescriptor } from '@/nodes/helpers';
import { useLatestReadyValue } from '@/hooks/useLatestReadyValue';
import { useViewportMediaCache, type UseViewportMediaCacheOptions } from './useViewportMediaCache';
import type { TextureCache } from '@/utils/textureCache';

type UseViewportMediaResourcesOptions = Omit<
  UseViewportMediaCacheOptions,
  'nodes' | 'retentionNodes'
> & {
  activeNodes: AnyNode[];
  retentionNodes: AnyNode[];
};

export const createViewportMediaCacheContext = (cache: TextureCache): MediaCacheContext => ({
  imageCache: cache,
  videoElements: new Map(
    Array.from(cache.entries())
      .filter(([, entry]) => entry.video)
      .map(([key, entry]) => [key, entry.video!]),
  ),
  sequenceCache: cache,
});

export const areViewportMediaNodesReady = (
  nodes: AnyNode[],
  frame: number,
  cache: TextureCache,
): boolean => {
  if (nodes.length === 0) return true;
  const cacheContext = createViewportMediaCacheContext(cache);

  return nodes.every((node) => {
    if (!node.enabled) return true;
    const descriptor = getMediaDescriptor(node.type);
    return !descriptor || descriptor.checkFrameReady(node, frame, cacheContext);
  });
};

/** Owns viewport media caching, readiness, and atomic frame presentation. */
export const useViewportMediaResources = ({
  activeNodes,
  retentionNodes,
  currentFrame,
  ...cacheOptions
}: UseViewportMediaResourcesOptions) => {
  const cache = useViewportMediaCache({
    ...cacheOptions,
    nodes: activeNodes,
    retentionNodes,
    currentFrame,
  });
  const isRenderReady = areViewportMediaNodesReady(
    activeNodes,
    currentFrame,
    cache.textureCacheRef.current,
  );
  const presentation = useLatestReadyValue(currentFrame, isRenderReady);

  return {
    ...cache,
    visualFrame: presentation.value,
    isRenderReady,
    isLoading: presentation.isPending,
  };
};
