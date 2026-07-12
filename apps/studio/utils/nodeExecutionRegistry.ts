type NodeExecutionSource = 'nodeAction' | 'properties' | 'viewportTool' | 'chat';

export interface NodeExecutionContext {
  source?: NodeExecutionSource;
  runCount?: number;
  regionId?: string;
  workflowId?: string;
  controlValueOverrides?: Record<string, string | number | boolean>;
  generationGroupId?: string;
}

export type NodeExecutionHandler = (context?: NodeExecutionContext) => void | Promise<void>;

const nodeExecutionHandlers = new Map<string, NodeExecutionHandler>();
const pendingExecutionTimers = new Map<string, number>();
const pendingExecutionContexts = new Map<string, NodeExecutionContext | undefined>();
const PENDING_EXECUTION_MS = 1500;

const clearPendingExecution = (nodeId: string) => {
  const timer = pendingExecutionTimers.get(nodeId);
  if (timer !== undefined && typeof window !== 'undefined') {
    window.clearTimeout(timer);
  }
  pendingExecutionTimers.delete(nodeId);
  pendingExecutionContexts.delete(nodeId);
};

const executeRegisteredNode = (nodeId: string, context?: NodeExecutionContext): boolean => {
  const handler = nodeExecutionHandlers.get(nodeId);
  if (!handler) return false;

  try {
    void Promise.resolve(handler(context)).catch((error) => {
      console.error(`Node execution failed for ${nodeId}`, error);
    });
  } catch (error) {
    console.error(`Node execution failed for ${nodeId}`, error);
  }

  return true;
};

export const requestRegisteredNodeExecution = (
  nodeId: string,
  context?: NodeExecutionContext,
): boolean => {
  if (executeRegisteredNode(nodeId, context)) return true;
  if (typeof window === 'undefined') return false;

  clearPendingExecution(nodeId);
  const timer = window.setTimeout(() => {
    pendingExecutionTimers.delete(nodeId);
    pendingExecutionContexts.delete(nodeId);
  }, PENDING_EXECUTION_MS);
  pendingExecutionTimers.set(nodeId, timer);
  pendingExecutionContexts.set(nodeId, context);

  window.requestAnimationFrame(() => {
    if (executeRegisteredNode(nodeId, context)) {
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
    const context = pendingExecutionContexts.get(nodeId);
    clearPendingExecution(nodeId);
    window.setTimeout(() => {
      executeRegisteredNode(nodeId, context);
    }, 0);
  }

  return () => {
    if (nodeExecutionHandlers.get(nodeId) === handler) {
      nodeExecutionHandlers.delete(nodeId);
    }
  };
};
