import { useEffect } from 'react';
import {
  registerNodeExecutionHandler,
  type NodeExecutionHandler,
} from '@/utils/nodeExecutionRegistry';

export const useNodeExecutionHandler = (nodeId: string, handler: NodeExecutionHandler) => {
  useEffect(() => registerNodeExecutionHandler(nodeId, handler), [handler, nodeId]);
};
