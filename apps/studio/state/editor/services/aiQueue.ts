import {
  AnyNode,
  ImageNode,
  NodeType,
  AiGenerationTaskInput,
  QueuedAiGenerationTask,
} from '@blackboard/types';

interface AiSuccessPayload {
  assetId: string;
  width: number;
  height: number;
}

const hasAiMetadata = (node: AnyNode): node is ImageNode => {
  return node.type === NodeType.IMAGE && typeof node.aiMetadata !== 'undefined';
};

export const buildQueuedAiTask = (task: AiGenerationTaskInput): QueuedAiGenerationTask => {
  return {
    ...task,
    taskId: `task_${Date.now()}`,
  };
};

export const enqueueAiTask = (
  nodes: AnyNode[],
  queue: QueuedAiGenerationTask[],
  task: QueuedAiGenerationTask,
): { nodes: AnyNode[]; queue: QueuedAiGenerationTask[] } => {
  const nextQueue = [...queue, task];
  const nextNodes = nodes.map((node) => {
    if (!hasAiMetadata(node) || node.id !== task.nodeId) {
      return node;
    }

    const nextVariant = {
      src: '',
      prompt: task.prompt,
      createdAt: Date.now(),
      taskId: task.taskId,
      status: 'queued' as const,
      queuePosition: nextQueue.length,
    };

    return {
      ...node,
      aiMetadata: {
        ...node.aiMetadata!,
        variants: [...node.aiMetadata!.variants, nextVariant],
        activeVariantIndex: node.aiMetadata!.variants.length,
        prompt: task.prompt,
      },
    } as ImageNode;
  });

  return { nodes: nextNodes, queue: nextQueue };
};

export const markAiTaskGenerating = (nodes: AnyNode[], task: QueuedAiGenerationTask): AnyNode[] => {
  return nodes.map((node) => {
    if (!hasAiMetadata(node) || node.id !== task.nodeId) {
      return node;
    }

    return {
      ...node,
      aiMetadata: {
        ...node.aiMetadata!,
        variants: node.aiMetadata!.variants.map((variant) =>
          variant.taskId === task.taskId ? { ...variant, status: 'generating' as const } : variant,
        ),
      },
    } as ImageNode;
  });
};

export const applyAiTaskSuccess = (
  nodes: AnyNode[],
  task: QueuedAiGenerationTask,
  payload: AiSuccessPayload,
): AnyNode[] => {
  return nodes.map((node) => {
    if (!hasAiMetadata(node) || node.id !== task.nodeId) {
      return node;
    }

    const updatedVariants = node.aiMetadata!.variants.map((variant) =>
      variant.taskId === task.taskId
        ? {
            ...variant,
            src: payload.assetId,
            width: payload.width,
            height: payload.height,
            status: undefined,
          }
        : variant,
    );

    return {
      ...node,
      src: payload.assetId,
      width: payload.width,
      height: payload.height,
      aiMetadata: {
        ...node.aiMetadata!,
        variants: updatedVariants,
      },
    } as ImageNode;
  });
};

export const applyAiTaskError = (
  nodes: AnyNode[],
  task: QueuedAiGenerationTask,
  message: string,
): AnyNode[] => {
  return nodes.map((node) => {
    if (!hasAiMetadata(node) || node.id !== task.nodeId) {
      return node;
    }

    return {
      ...node,
      aiMetadata: {
        ...node.aiMetadata!,
        variants: node.aiMetadata!.variants.map((variant) =>
          variant.taskId === task.taskId ? { ...variant, status: 'error' as const } : variant,
        ),
        lastError: message,
      },
    } as ImageNode;
  });
};

export const completeAiQueueHead = (
  nodes: AnyNode[],
  queue: QueuedAiGenerationTask[],
): { nodes: AnyNode[]; queue: QueuedAiGenerationTask[] } => {
  const remainingQueue = queue.slice(1);
  const nextNodes = nodes.map((node) => {
    if (!hasAiMetadata(node)) {
      return node;
    }

    return {
      ...node,
      aiMetadata: {
        ...node.aiMetadata!,
        variants: node.aiMetadata!.variants.map((variant) => {
          const queueIndex = remainingQueue.findIndex(
            (queuedTask) => queuedTask.taskId === variant.taskId,
          );
          return queueIndex !== -1 ? { ...variant, queuePosition: queueIndex + 1 } : variant;
        }),
      },
    } as ImageNode;
  });

  return { nodes: nextNodes, queue: remainingQueue };
};
