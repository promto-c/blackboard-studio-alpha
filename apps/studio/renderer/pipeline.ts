import {
  configureRawStraightAlphaTexture,
  renderWithSharedPipeline as _renderWithSharedPipeline,
  renderViewportFrameWithSharedPipeline as _renderViewportFrameWithSharedPipeline,
  type RenderPipelineOptions as _RenderPipelineOptions,
  type ViewportPipelineOptions as _ViewportPipelineOptions,
  type RendererColorManagement,
} from '@blackboard/renderer';
import {
  NodeType,
  RotoAlphaMode,
  type AnyNode,
  type PaintNode,
  type ProjectColorManagement,
  type RotoNode,
} from '@blackboard/types';
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import {
  buildPaintAlphaCompositeRaster,
  buildPaintCompositeRaster,
} from '@/nodes/builtin/paint/paintRaster';
import { withSharedPaintSnapshotRenderer } from '@/nodes/builtin/paint/paintSnapshotRenderer';
import {
  renderTargetToPaintCloneSource,
  type PaintCloneSource,
  type PaintRaster,
} from '@/nodes/builtin/paint/paintFloatReadback';
import { getPaintTextureCommittedState } from '@/nodes/builtin/paint/paintTextureKeys';
import { nodeRegistry } from '@/nodes/registry';
import { getAsset } from '@/state/assetStorage';
import { createExrTexture } from '@/utils/exr';
import { getBlobName, isExrFileLike, isHdrFileLike } from '@/utils/mediaFiles';
import { colorManagementService } from '@/color-management';
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

// Studio injects app-owned registry, asset, paint, and color-management services.
export type RenderPipelineOptions = Omit<
  _RenderPipelineOptions,
  'nodeRegistry' | 'getAsset' | 'getPaintTextures' | 'loadAssetTexture' | 'colorManagement'
> & { projectColorManagement: ProjectColorManagement };
export type ViewportPipelineOptions = Omit<
  _ViewportPipelineOptions,
  'nodeRegistry' | 'colorManagement'
> & { projectColorManagement: ProjectColorManagement };

type RuntimePaintTextures = { color: THREE.Texture; alpha: THREE.Texture };

interface RuntimePaintTextureCacheEntry {
  key: string;
  projectColorManagement: ProjectColorManagement;
  textures: Promise<RuntimePaintTextures | null>;
}

const paintTextureCache = new Map<string, RuntimePaintTextureCacheEntry>();

const configurePaintTexture = (texture: THREE.Texture) => {
  configureRawStraightAlphaTexture(texture);
};

const createRuntimePaintTexture = (
  raster: PaintRaster | null,
  width: number,
  height: number,
): THREE.Texture => {
  const texture = new THREE.DataTexture(
    raster?.rgba ?? new Float32Array(width * height * 4),
    raster?.width ?? width,
    raster?.height ?? height,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.flipY = true;
  texture.unpackAlignment = 1;
  configurePaintTexture(texture);
  return texture;
};

const disposeRuntimePaintTextures = (textures: Promise<RuntimePaintTextures | null>) => {
  void textures.then((resolved) => {
    resolved?.color.dispose();
    resolved?.alpha.dispose();
  });
};

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

const getRuntimePaintTextures = async (
  node: PaintNode,
  upstreamNodes: AnyNode[],
  upstreamPaintTextures: ReadonlyMap<string, RuntimePaintTextures>,
  frame: number,
  width: number,
  height: number,
  sceneNode: Extract<RenderPipelineOptions['sceneNode'], { bitDepth: 8 | 16 | 32 }>,
  projectColorManagement: ProjectColorManagement,
  rendererColorManagement: RendererColorManagement,
): Promise<RuntimePaintTextures | null> => {
  const { committedKey, requiresDynamicCloneSource } = getPaintTextureCommittedState({
    node,
    nodes: [...upstreamNodes, node],
    frame,
    width,
    height,
  });
  const cacheKey = `${node.id}:${committedKey}`;
  const cached = paintTextureCache.get(node.id);
  if (cached?.key === cacheKey && cached.projectColorManagement === projectColorManagement) {
    return cached.textures;
  }
  if (cached) {
    paintTextureCache.delete(node.id);
    disposeRuntimePaintTextures(cached.textures);
  }

  const cloneSourcePromise = requiresDynamicCloneSource
    ? (async () => {
        return withSharedPaintSnapshotRenderer(async (renderer) => {
          const { finalOutputTarget, dispose } = await _renderWithSharedPipeline({
            captureFinalOutput: true,
            nodes: upstreamNodes,
            sceneNode,
            frame,
            width,
            height,
            finalColorSpace: 'scene_linear',
            presentToCanvas: false,
            colorManagement: rendererColorManagement,
            textureCacheMode: 'persistent',
            renderer,
            nodeRegistry,
            getAsset,
            getPaintTextures: (nodeId) => upstreamPaintTextures.get(nodeId),
            loadAssetTexture: loadStudioAssetTexture,
          });

          try {
            if (!finalOutputTarget) {
              throw new Error('Clone sampling requires a floating-point renderer capture.');
            }
            return renderTargetToPaintCloneSource(renderer, finalOutputTarget);
          } finally {
            dispose();
          }
        });
      })()
    : Promise.resolve<PaintCloneSource | null>(null);

  const textures = cloneSourcePromise
    .then(async (cloneSource) =>
      Promise.all([
        buildPaintCompositeRaster(node.strokes, width, height, node.layers, frame, {
          resolveCloneSource: async () => cloneSource,
        }),
        buildPaintAlphaCompositeRaster(node.strokes, width, height, node.layers, frame, {
          resolveCloneSource: async () => cloneSource,
        }),
      ]),
    )
    .then(([colorRaster, alphaRaster]) =>
      colorRaster || alphaRaster
        ? {
            color: createRuntimePaintTexture(colorRaster, width, height),
            alpha: createRuntimePaintTexture(alphaRaster, width, height),
          }
        : null,
    )
    .catch((error) => {
      if (paintTextureCache.get(node.id)?.key === cacheKey) {
        paintTextureCache.delete(node.id);
      }
      throw error;
    });

  paintTextureCache.set(node.id, { key: cacheKey, projectColorManagement, textures });
  return textures;
};

const resolvePaintNodesForFrame = async (
  nodes: AnyNode[],
  frame: number,
  width: number,
  height: number,
  sceneNode: Extract<RenderPipelineOptions['sceneNode'], { bitDepth: 8 | 16 | 32 }>,
  projectColorManagement: ProjectColorManagement,
  rendererColorManagement: RendererColorManagement,
): Promise<{ nodes: AnyNode[]; textures: Map<string, RuntimePaintTextures> }> =>
  nodes.reduce<Promise<{ nodes: AnyNode[]; textures: Map<string, RuntimePaintTextures> }>>(
    async (resolvedPromise, node) => {
      const resolved = await resolvedPromise;
      if (node.type !== NodeType.PAINT) {
        resolved.nodes.push(node);
        return resolved;
      }

      const paintNode = node as PaintNode;
      const paintTextures = await getRuntimePaintTextures(
        paintNode,
        resolved.nodes,
        resolved.textures,
        frame,
        width,
        height,
        sceneNode,
        projectColorManagement,
        rendererColorManagement,
      );
      if (paintTextures) {
        resolved.textures.set(paintNode.id, paintTextures);
      }
      resolved.nodes.push(paintNode);
      return resolved;
    },
    Promise.resolve({ nodes: [], textures: new Map() }),
  );

export const renderWithSharedPipeline = async (options: RenderPipelineOptions) => {
  const { projectColorManagement, ...pipelineOptions } = options;
  const rendererColorManagement =
    colorManagementService.getProjectRendererColorManagement(projectColorManagement);
  const frame = options.frame ?? 0;
  const resolvedPaint = await resolvePaintNodesForFrame(
    options.nodes,
    frame,
    options.sceneNode.width,
    options.sceneNode.height,
    options.sceneNode,
    projectColorManagement,
    rendererColorManagement,
  );
  const { nodes } = resolvedPaint;
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
      getAsset,
      getRotoMaskLayers: (nodeId) => rotoMasks.layers.get(nodeId),
      getRotoAlphaMode: (nodeId) => rotoAlphaModeMap.get(nodeId) ?? 0,
      getPaintTextures: (nodeId) => resolvedPaint.textures.get(nodeId),
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
  });
};
