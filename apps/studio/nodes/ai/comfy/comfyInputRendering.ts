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
  sceneNode: SceneNode;
  projectColorManagement: ProjectColorManagement;
  frame: number;
  region?: Pick<ViewportPromptRegion, 'rect'> | null;
  regionInputAlphaMode?: 'opaque' | 'preserve';
}

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
