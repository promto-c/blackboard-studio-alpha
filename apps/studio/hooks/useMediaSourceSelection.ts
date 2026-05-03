import { useEffect, useMemo, useState } from 'react';
import { AnyNode } from '@blackboard/types';
import {
  getDefaultMediaSourceId,
  getMediaSourceOptions,
  isUpstreamMediaSourceId,
  isValidMediaSourceId,
} from '@/utils/mediaSourceSelection';

export const useMediaSourceSelection = (nodes: AnyNode[], currentNodeId: string) => {
  const defaultSourceId = useMemo(
    () => getDefaultMediaSourceId(nodes, currentNodeId),
    [nodes, currentNodeId],
  );
  const options = useMemo(
    () => getMediaSourceOptions(nodes, currentNodeId),
    [nodes, currentNodeId],
  );
  const [sourceId, setSourceId] = useState(defaultSourceId);

  useEffect(() => {
    if (!isValidMediaSourceId(nodes, currentNodeId, sourceId)) {
      setSourceId(defaultSourceId);
    }
  }, [currentNodeId, defaultSourceId, nodes, sourceId]);

  return {
    sourceId,
    setSourceId,
    options,
    defaultSourceId,
    isUpstreamSource: isUpstreamMediaSourceId(sourceId),
  };
};
