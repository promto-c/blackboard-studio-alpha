import {
  renderWithSharedPipeline as _renderWithSharedPipeline,
  renderViewportFrameWithSharedPipeline as _renderViewportFrameWithSharedPipeline,
  type RenderPipelineOptions as _RenderPipelineOptions,
  type ViewportPipelineOptions as _ViewportPipelineOptions,
} from '@blackboard/renderer';
import { NodeType, type AnyNode, type PaintNode } from '@blackboard/types';
import {
  buildPaintAlphaCompositeDataUrl,
  buildPaintCompositeDataUrl,
} from '@/effects/paint/paintRaster';
import { withSharedPaintSnapshotRenderer } from '@/effects/paint/paintSnapshotRenderer';
import { getPaintTextureCommittedState } from '@/effects/paint/paintTextureKeys';
import { getCanvasStorageColorTypeForBitDepth } from '@/utils/canvasColorType';
import { effectRegistry } from '@/effects/effectRegistry';
import { getAsset } from '@/state/assetStorage';
import { createExrTexture } from '@/utils/exr';
import { getBlobName, isExrFileLike } from '@/utils/mediaFiles';

export type {
  RenderPipelineResult,
  ViewportPipelineResources,
  ViewportPipelineResult,
} from '@blackboard/renderer';

// Omit injected fields so existing consumers don't need to change
export type RenderPipelineOptions = Omit<
  _RenderPipelineOptions,
  'effectRegistry' | 'getAsset' | 'loadAssetTexture'
>;
export type ViewportPipelineOptions = Omit<_ViewportPipelineOptions, 'effectRegistry'>;

interface RuntimePaintComposite {
  paintComposite: string;
  paintAlphaComposite: string;
}

const paintCompositeCache = new Map<string, Promise<RuntimePaintComposite>>();
const paintCompositeCacheKeyByNodeId = new Map<string, string>();

const loadStudioAssetTexture = async ({ assetId, blob }: { assetId: string; blob: Blob }) => {
  if (!isExrFileLike(blob, getBlobName(blob))) {
    return null;
  }
  return createExrTexture(blob, { cacheKey: assetId });
};

const getRuntimePaintComposite = async (
  node: PaintNode,
  upstreamNodes: AnyNode[],
  frame: number,
  width: number,
  height: number,
  sceneBitDepth: 8 | 16 | 32,
  sceneNode: Extract<RenderPipelineOptions['sceneNode'], { bitDepth: 8 | 16 | 32 }>,
): Promise<RuntimePaintComposite> => {
  const { committedKey, requiresDynamicCloneSource } = getPaintTextureCommittedState({
    node,
    nodes: [...upstreamNodes, node],
    frame,
    width,
    height,
  });
  const cacheKey = `${node.id}:${committedKey}`;
  const previousKey = paintCompositeCacheKeyByNodeId.get(node.id);

  if (previousKey && previousKey !== cacheKey) {
    paintCompositeCache.delete(previousKey);
  }

  paintCompositeCacheKeyByNodeId.set(node.id, cacheKey);

  const cached = paintCompositeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const cloneSourceCanvasPromise = requiresDynamicCloneSource
    ? (async () => {
        const finalColorSpace = sceneNode.colorSpace === 'Linear' ? 'srgb' : 'raw_texture';
        return withSharedPaintSnapshotRenderer(async (renderer) => {
          const { canvas, dispose } = await _renderWithSharedPipeline({
            captureFinalOutput: true,
            nodes: upstreamNodes,
            sceneNode,
            frame,
            width,
            height,
            finalColorSpace,
            textureCacheMode: 'persistent',
            renderer,
            effectRegistry,
            getAsset,
            loadAssetTexture: loadStudioAssetTexture,
          });

          try {
            return canvas;
          } finally {
            dispose();
          }
        });
      })()
    : Promise.resolve<HTMLCanvasElement | null>(null);

  const compositePromise = cloneSourceCanvasPromise
    .then(async (cloneSourceCanvas) =>
      Promise.all([
        buildPaintCompositeDataUrl(
          node.strokes,
          width,
          height,
          node.layers,
          frame,
          getCanvasStorageColorTypeForBitDepth(sceneBitDepth),
          { resolveCloneSourceCanvas: async () => cloneSourceCanvas },
        ),
        buildPaintAlphaCompositeDataUrl(
          node.strokes,
          width,
          height,
          node.layers,
          frame,
          getCanvasStorageColorTypeForBitDepth(sceneBitDepth),
          { resolveCloneSourceCanvas: async () => cloneSourceCanvas },
        ),
      ]),
    )
    .then(([paintComposite, paintAlphaComposite]) => ({
      paintComposite,
      paintAlphaComposite,
    }))
    .catch((error) => {
      paintCompositeCache.delete(cacheKey);
      throw error;
    });

  paintCompositeCache.set(cacheKey, compositePromise);
  return compositePromise;
};

const resolvePaintNodesForFrame = async (
  nodes: AnyNode[],
  frame: number,
  width: number,
  height: number,
  sceneBitDepth: 8 | 16 | 32,
  sceneNode: Extract<RenderPipelineOptions['sceneNode'], { bitDepth: 8 | 16 | 32 }>,
): Promise<AnyNode[]> =>
  nodes.reduce<Promise<AnyNode[]>>(async (resolvedPromise, node) => {
    const resolvedNodes = await resolvedPromise;
    if (node.type !== NodeType.PAINT) {
      resolvedNodes.push(node);
      return resolvedNodes;
    }

    const paintNode = node as PaintNode;
    const paintComposite = await getRuntimePaintComposite(
      paintNode,
      resolvedNodes,
      frame,
      width,
      height,
      sceneBitDepth,
      sceneNode,
    );

    resolvedNodes.push(
      paintComposite.paintComposite || paintComposite.paintAlphaComposite
        ? ({
            ...paintNode,
            paintComposite: paintComposite.paintComposite,
            paintAlphaComposite: paintComposite.paintAlphaComposite,
          } as AnyNode)
        : paintNode,
    );
    return resolvedNodes;
  }, Promise.resolve([]));

export const renderWithSharedPipeline = async (options: RenderPipelineOptions) => {
  const frame = options.frame ?? 0;
  const nodes = await resolvePaintNodesForFrame(
    options.nodes,
    frame,
    options.sceneNode.width,
    options.sceneNode.height,
    options.sceneNode.bitDepth,
    options.sceneNode,
  );

  return _renderWithSharedPipeline({
    ...options,
    nodes,
    effectRegistry,
    getAsset,
    loadAssetTexture: loadStudioAssetTexture,
  });
};

export const renderViewportFrameWithSharedPipeline = (options: ViewportPipelineOptions) =>
  _renderViewportFrameWithSharedPipeline({ ...options, effectRegistry });
