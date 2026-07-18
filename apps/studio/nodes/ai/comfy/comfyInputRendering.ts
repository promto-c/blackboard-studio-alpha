import type {
  AnyNode,
  Flow,
  ProjectColorManagement,
  SceneNode,
  ViewportPromptRegion,
} from '@blackboard/types';
import {
  renderNodeInputFrameToPngBlob,
  renderNodeInputRegionToPngBlob,
} from '@/utils/nodeInputFrame';

/** Comfy image models consume ordinary sRGB-encoded image pixels. */
export const COMFY_INFERENCE_FINAL_COLOR_SPACE = 'srgb' as const;

export const getComfyRenderedInputName = (sourceName: string): string =>
  `${sourceName || 'input'}.render.png`;

interface RenderComfyConnectedInputOptions {
  nodes: AnyNode[];
  flows: Record<string, Flow>;
  sourceNodeId: string;
  sourcePort?: string;
  sceneNode: SceneNode;
  projectColorManagement: ProjectColorManagement;
  frame: number;
  region?: Pick<ViewportPromptRegion, 'rect'> | null;
  regionInputAlphaMode?: 'opaque' | 'preserve';
}

export const getComfyConnectedInputSourcePort = ({
  flows,
  targetNodeId,
  targetPort,
  sourceNodeId,
}: {
  flows: Record<string, Flow>;
  targetNodeId: string;
  targetPort: string;
  sourceNodeId: string;
}): string | undefined => {
  for (const flow of Object.values(flows)) {
    const edge = flow.edges.find(
      (candidate) =>
        candidate.targetNodeId === targetNodeId &&
        candidate.targetPort === targetPort &&
        candidate.sourceNodeId === sourceNodeId,
    );
    if (edge) return edge.sourcePort;
  }
  return undefined;
};

/**
 * Produces the exact PNG uploaded for a graph-connected Comfy image input.
 * Root and region runs intentionally share the same color-managed render path.
 */
export const renderComfyConnectedInputToPngBlob = async (
  options: RenderComfyConnectedInputOptions,
): Promise<Blob> => {
  const common = {
    nodes: options.nodes,
    flows: options.flows,
    sourceNodeId: options.sourceNodeId,
    ...(options.sourcePort ? { sourcePort: options.sourcePort } : {}),
    sceneNode: options.sceneNode,
    projectColorManagement: options.projectColorManagement,
    frame: options.frame,
    finalColorSpace: COMFY_INFERENCE_FINAL_COLOR_SPACE,
  };

  if (options.region) {
    return renderNodeInputRegionToPngBlob({
      ...common,
      regionRect: options.region.rect,
      regionInputAlphaMode: options.regionInputAlphaMode,
    });
  }

  return renderNodeInputFrameToPngBlob(common);
};
