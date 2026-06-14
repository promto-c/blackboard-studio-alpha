import {
  type AiChatRenderComparisonArtifact,
  type AiChatRenderPreviewArtifact,
  type AiChatRenderPreviewImage,
  type AnyNode,
  type Flow,
  type PersistedProjectState,
  type SceneNode,
} from '@blackboard/types';
import { buildNodeStacks } from './nodeStacks';
import type { AiToolExecutionResult } from './agentToolRegistry';
import { renderStackToDataURL } from './thumbnailRenderer';
import { isSceneNode } from './guards';

interface AgentRenderPreviewOptions {
  branchId?: string;
  flowId?: string;
  nodeId?: string;
  frame?: number;
}

interface AgentRenderComparisonOptions extends AgentRenderPreviewOptions {
  beforeBranchId?: string;
  afterBranchId?: string;
}

interface AgentRenderPreviewTarget {
  flow: Flow;
  sceneNode: SceneNode;
  stack: AnyNode[];
  node: AnyNode;
}

const getPreviewFlow = (projectState: PersistedProjectState, flowId?: string): Flow | null => {
  const flows = projectState.flows ?? {};
  if (flowId) {
    return flows[flowId] ?? null;
  }

  return (
    (projectState.activeFlowId ? flows[projectState.activeFlowId] : null) ??
    (projectState.rootFlowId ? flows[projectState.rootFlowId] : null) ??
    Object.values(flows)[0] ??
    null
  );
};

export const resolveAgentRenderPreviewTarget = (
  projectState: PersistedProjectState,
  options: AgentRenderPreviewOptions = {},
): AgentRenderPreviewTarget | null => {
  const flow = getPreviewFlow(projectState, options.flowId);
  if (!flow) return null;

  const sceneNode = flow.nodes.find(isSceneNode);
  if (!sceneNode) return null;

  const stacks = buildNodeStacks(flow.nodes);
  if (stacks.length === 0) return null;

  const requestedStack = options.nodeId
    ? stacks.find((stack) => stack.some((node) => node.id === options.nodeId))
    : null;
  const stack = requestedStack ?? stacks[0];
  const node =
    (options.nodeId ? stack.find((candidate) => candidate.id === options.nodeId) : null) ??
    stack[stack.length - 1];

  if (!node) return null;

  return {
    flow,
    sceneNode,
    stack,
    node,
  };
};

async function captureAgentRenderPreview(
  projectState: PersistedProjectState,
  options: AgentRenderPreviewOptions = {},
): Promise<AiToolExecutionResult<AiChatRenderPreviewArtifact | null>> {
  if (typeof document === 'undefined') {
    return {
      content: 'Render preview capture is only available in the browser runtime.',
      artifact: null,
    };
  }

  const target = resolveAgentRenderPreviewTarget(projectState, options);
  if (!target) {
    return {
      content: 'No renderable stack was found in the requested agent snapshot.',
      artifact: null,
    };
  }

  const frame = Math.max(0, Math.floor(options.frame ?? projectState.currentFrame ?? 0));
  const dataUrl = await renderStackToDataURL(target.stack, target.sceneNode, frame);
  const artifact: AiChatRenderPreviewArtifact = {
    type: 'render-preview',
    dataUrl,
    mimeType: 'image/png',
    width: target.sceneNode.width,
    height: target.sceneNode.height,
    frame,
    flowId: target.flow.id,
    branchId: options.branchId,
    nodeId: target.node.id,
    nodeName: target.node.name,
    summary: `Captured frame ${frame} from ${target.node.name}.`,
    capturedAt: Date.now(),
  };

  return {
    content: artifact.summary,
    artifact,
  };
}

const toRenderPreviewImage = (artifact: AiChatRenderPreviewArtifact): AiChatRenderPreviewImage => {
  const { type: _type, capturedAt: _capturedAt, ...image } = artifact;
  return image;
};

export async function captureAgentRenderPreviewComparison(
  beforeState: PersistedProjectState,
  afterState: PersistedProjectState,
  options: AgentRenderComparisonOptions = {},
): Promise<AiToolExecutionResult<AiChatRenderComparisonArtifact | null>> {
  const frame = Math.max(
    0,
    Math.floor(options.frame ?? afterState.currentFrame ?? beforeState.currentFrame ?? 0),
  );
  const before = await captureAgentRenderPreview(beforeState, {
    ...options,
    branchId: options.beforeBranchId,
    frame,
  });
  const after = await captureAgentRenderPreview(afterState, {
    ...options,
    branchId: options.afterBranchId,
    frame,
  });

  if (!before.artifact || !after.artifact) {
    return {
      content: before.artifact
        ? after.content
        : before.content || 'Could not capture before/after render previews.',
      artifact: null,
    };
  }

  const summary = `Captured before/after render comparison for frame ${frame}.`;
  return {
    content: summary,
    artifact: {
      type: 'render-comparison',
      before: toRenderPreviewImage(before.artifact),
      after: toRenderPreviewImage(after.artifact),
      parentBranchId: options.beforeBranchId,
      branchId: options.afterBranchId,
      summary,
      capturedAt: Date.now(),
    },
  };
}
