import type { NodeRegistryLike } from './types';

const isPipelineAdjustmentRenderMode = (renderMode?: string): boolean =>
  renderMode === 'shader' ||
  renderMode === 'ocio' ||
  renderMode === 'multipass' ||
  renderMode === 'paint' ||
  renderMode === 'mask' ||
  renderMode === 'warp';

/**
 * A primary-input pass consumes the upstream image through the host-provided
 * `pipe` input. Tool categories only organize the UI; they must not decide
 * whether a render-capable node executes.
 */
const isPrimaryInputPass = (definition: ReturnType<NodeRegistryLike['get']>): boolean =>
  !!definition &&
  !definition.flags?.isSource &&
  !definition.flags?.isSceneLike &&
  isPipelineAdjustmentRenderMode(definition.renderMode);

export const createNodePredicates = (nodeRegistry: NodeRegistryLike) => ({
  isPrimaryInputNodeType: (type: string): boolean => {
    const def = nodeRegistry.get(type);
    return isPrimaryInputPass(def);
  },
});
