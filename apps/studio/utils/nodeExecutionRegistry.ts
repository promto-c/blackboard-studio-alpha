export type NodeExecutionHandler = () => void | Promise<void>;

const nodeExecutionHandlers = new Map<string, NodeExecutionHandler>();
const pendingExecutionTimers = new Map<string, number>();
const PENDING_EXECUTION_MS = 1500;

const clearPendingExecution = (nodeId: string) => {
  const timer = pendingExecutionTimers.get(nodeId);
  if (timer !== undefined && typeof window !== 'undefined') {
    window.clearTimeout(timer);
  }
  pendingExecutionTimers.delete(nodeId);
};

export const executeRegisteredNode = (nodeId: string): boolean => {
  const handler = nodeExecutionHandlers.get(nodeId);
  if (!handler) return false;

  try {
    void Promise.resolve(handler()).catch((error) => {
      console.error(`Node execution failed for ${nodeId}`, error);
    });
  } catch (error) {
    console.error(`Node execution failed for ${nodeId}`, error);
  }

  return true;
};

export const requestRegisteredNodeExecution = (nodeId: string): boolean => {
  if (executeRegisteredNode(nodeId)) return true;
  if (typeof window === 'undefined') return false;

  clearPendingExecution(nodeId);
  const timer = window.setTimeout(() => {
    pendingExecutionTimers.delete(nodeId);
  }, PENDING_EXECUTION_MS);
  pendingExecutionTimers.set(nodeId, timer);

  window.requestAnimationFrame(() => {
    if (executeRegisteredNode(nodeId)) {
      clearPendingExecution(nodeId);
    }
  });

  return false;
};

export const registerNodeExecutionHandler = (
  nodeId: string,
  handler: NodeExecutionHandler,
): (() => void) => {
  nodeExecutionHandlers.set(nodeId, handler);

  if (pendingExecutionTimers.has(nodeId) && typeof window !== 'undefined') {
    clearPendingExecution(nodeId);
    window.setTimeout(() => {
      executeRegisteredNode(nodeId);
    }, 0);
  }

  return () => {
    if (nodeExecutionHandlers.get(nodeId) === handler) {
      nodeExecutionHandlers.delete(nodeId);
    }
  };
};
