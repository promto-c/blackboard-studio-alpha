import {
  configureRawStraightAlphaTexture,
  renderWithSharedPipeline as _renderWithSharedPipeline,
  renderViewportFrameWithSharedPipeline as _renderViewportFrameWithSharedPipeline,
  type RenderPipelineOptions as _RenderPipelineOptions,
  type ViewportPipelineOptions as _ViewportPipelineOptions,
} from '@blackboard/renderer';
import {
  NodeType,
  RotoAlphaMode,
  type ProjectColorManagement,
  type RotoNode,
} from '@blackboard/types';
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { disposePaintGpuEngine } from '@/nodes/builtin/paint/paintGpuEngine';
import { nodeRegistry } from '@/nodes/registry';
import { getAsset } from '@/state/assetStorage';
import { createExrTexture } from '@/utils/exr';
import { getBlobName, isExrFileLike, isHdrFileLike } from '@/utils/mediaFiles';
import { colorManagementService } from '@/color-management';
import { getDataWindowProjection } from '@/features/viewport/dataWindow';
import { createRotoMaskTextureBundle } from '@/utils/rotoMaskTexture';
import {
  disposeScene3DProjectionRuntimes,
  pruneScene3DProjectionRuntimes,
} from './scene3dRenderer';

export type {
  RenderPipelineResult,
  ViewportPipelineResources,
  ViewportPipelineResult,
} from '@blackboard/renderer';

// Studio injects app-owned registry, asset, and color-management services.
export type RenderPipelineOptions = Omit<
  _RenderPipelineOptions,
  'nodeRegistry' | 'getAsset' | 'loadAssetTexture' | 'colorManagement'
> & { projectColorManagement: ProjectColorManagement };
export type ViewportPipelineOptions = Omit<
  _ViewportPipelineOptions,
  'nodeRegistry' | 'colorManagement'
> & { projectColorManagement: ProjectColorManagement };

const loadStudioAssetTexture = async ({ assetId, blob }: { assetId: string; blob: Blob }) => {
  const name = getBlobName(blob);
  if (isExrFileLike(blob, name)) {
    return createExrTexture(blob, { cacheKey: assetId });
  }
  if (isHdrFileLike(blob, name)) {
    const decoded = new HDRLoader().parse(await blob.arrayBuffer());
    const texture = new THREE.DataTexture(
      decoded.data,
      decoded.width,
      decoded.height,
      THREE.RGBAFormat,
      decoded.type,
    );
    texture.name = assetId;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.flipY = true;
    configureRawStraightAlphaTexture(texture);
    texture.needsUpdate = true;
    return texture;
  }
  return null;
};

export const renderWithSharedPipeline = async (options: RenderPipelineOptions) => {
  const { projectColorManagement, ...pipelineOptions } = options;
  const rendererColorManagement =
    colorManagementService.getProjectRendererColorManagement(projectColorManagement);
  const frame = options.frame ?? 0;
  const { nodes } = options;
  const dataWindowNodes = [...nodes];
  const dataWindowNodeIds = new Set(nodes.map((node) => node.id));
  for (const node of options.captureSourceNodes ?? []) {
    if (!dataWindowNodeIds.has(node.id)) {
      dataWindowNodes.push(node);
      dataWindowNodeIds.add(node.id);
    }
  }
  const rotoMasks = createRotoMaskTextureBundle(nodes, options.sceneNode, frame, {
    width: options.width,
    height: options.height,
    featherScale: options.blurRadiusScale,
  });

  const rotoAlphaModeMap = new Map<string, number>();
  nodes.forEach((n) => {
    if (n.type === NodeType.ROTO) {
      const mode = (n as RotoNode).alphaMode;
      rotoAlphaModeMap.set(
        n.id,
        mode === RotoAlphaMode.REPLACE ? 1 : mode === RotoAlphaMode.ADD ? 2 : 0,
      );
    }
  });

  try {
    const result = await _renderWithSharedPipeline({
      ...pipelineOptions,
      colorManagement: rendererColorManagement,
      nodes,
      nodeRegistry,
      dataWindowPlan: getDataWindowProjection(options.sceneNode, dataWindowNodes, frame),
      getAsset,
      getRotoMaskLayers: (nodeId) => rotoMasks.layers.get(nodeId),
      getRotoAlphaMode: (nodeId) => rotoAlphaModeMap.get(nodeId) ?? 0,
      loadAssetTexture: loadStudioAssetTexture,
    });
    pruneScene3DProjectionRuntimes(
      result.renderer,
      new Set(nodes.filter((node) => node.type === NodeType.SCENE_3D).map((node) => node.id)),
    );
    const ownsRenderer = !pipelineOptions.renderer;
    return {
      ...result,
      dispose: () => {
        if (ownsRenderer) {
          disposePaintGpuEngine(result.renderer);
        }
        result.dispose();
        if (ownsRenderer) {
          disposeScene3DProjectionRuntimes(result.renderer);
        }
        rotoMasks.dispose();
      },
    };
  } catch (error) {
    rotoMasks.dispose();
    throw error;
  }
};

export const renderViewportFrameWithSharedPipeline = (options: ViewportPipelineOptions) => {
  const { projectColorManagement, ...pipelineOptions } = options;
  return _renderViewportFrameWithSharedPipeline({
    ...pipelineOptions,
    colorManagement:
      colorManagementService.getProjectRendererColorManagement(projectColorManagement),
    nodeRegistry,
    dataWindowPlan: getDataWindowProjection(options.sceneNode, options.nodes, options.frame),
  });
};
