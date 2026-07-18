import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { type RendererMaskLayer } from '@blackboard/renderer';
import { NodeType, type AnyNode, type RotoNode, type SceneNode } from '@blackboard/types';
import {
  resolveRotoMotionBlurPreviewSamples,
  resolveRotoMotionBlurSettings,
} from '@/utils/rotoMotionBlur';
import { type RotoPointWeightMode } from '@/utils/rotoPointWeights';
import { createRotoMaskLayers } from '@/utils/rotoMaskTexture';
import { resolvePreviewRasterSize } from '@/utils/previewPerformance';

interface RotoMaskEntry {
  width: number;
  height: number;
  node: RotoNode;
  frame: number;
  optimized: boolean;
  motionBlurSampleCount: number;
  pointWeightMode: RotoPointWeightMode;
  textureCaches: Map<string, Map<string, THREE.CanvasTexture>>;
  maskLayers: RendererMaskLayer[];
  dispose: () => void;
}

const MAX_ROTO_RASTER_CACHE_VARIANTS = 3;

const getRotoTextureCache = (entry: RotoMaskEntry | undefined, width: number, height: number) => {
  const textureCaches = entry?.textureCaches ?? new Map();
  const sizeKey = `${width}x${height}`;
  const cached = textureCaches.get(sizeKey);

  if (cached) {
    // Refresh insertion order so the least recently used raster size is evicted.
    textureCaches.delete(sizeKey);
    textureCaches.set(sizeKey, cached);
    return { textureCaches, textureCache: cached };
  }

  if (textureCaches.size >= MAX_ROTO_RASTER_CACHE_VARIANTS) {
    const oldest = textureCaches.entries().next().value as
      | [string, Map<string, THREE.CanvasTexture>]
      | undefined;
    if (oldest) {
      oldest[1].forEach((texture) => texture.dispose());
      textureCaches.delete(oldest[0]);
    }
  }

  const textureCache = new Map<string, THREE.CanvasTexture>();
  textureCaches.set(sizeKey, textureCache);
  return { textureCaches, textureCache };
};

const disposeRotoTextureCaches = (textureCaches: Map<string, Map<string, THREE.CanvasTexture>>) => {
  textureCaches.forEach((textureCache) => {
    textureCache.forEach((texture) => texture.dispose());
  });
  textureCaches.clear();
};

interface UseViewportRotoMasksOptions {
  nodes: AnyNode[];
  sceneNode?: SceneNode;
  viewportSize: { width: number; height: number };
  currentFrame: number;
  optimizedPreviewActive: boolean;
  editingPreviewActive: boolean;
  editingNodeId: string | null;
  maxDimension: number;
  sampleLimit: number;
  rotoPointWeightMode: RotoPointWeightMode;
  suspendMaskUpdatesWhileEditing: boolean;
  reportPrepareDuration?: (durationMs: number) => void;
  bumpMediaUpdate: () => void;
}

export const useViewportRotoMasks = ({
  nodes,
  sceneNode,
  viewportSize,
  currentFrame,
  optimizedPreviewActive,
  editingPreviewActive,
  editingNodeId,
  maxDimension,
  sampleLimit,
  rotoPointWeightMode,
  suspendMaskUpdatesWhileEditing,
  reportPrepareDuration,
  bumpMediaUpdate,
}: UseViewportRotoMasksOptions) => {
  const rotoMaskTexturesRef = useRef<Map<string, RotoMaskEntry>>(new Map());

  useLayoutEffect(() => {
    if (!sceneNode) return;
    const prepareStartedAt = performance.now();

    const rotoNodes = nodes.filter(
      (node) => node.type === NodeType.ROTO && node.enabled,
    ) as RotoNode[];
    const nextMasks = new Map<string, RotoMaskEntry>();
    let requiresMediaUpdate = false;

    rotoNodes.forEach((node) => {
      const isEditingNode = editingPreviewActive && node.id === editingNodeId;
      const isProxyNode = optimizedPreviewActive && (!editingPreviewActive || isEditingNode);
      const rasterSize = resolvePreviewRasterSize(
        sceneNode,
        viewportSize,
        isProxyNode,
        maxDimension,
      );
      const motionBlur = resolveRotoMotionBlurSettings(node.motionBlur);
      const motionBlurEnabled = motionBlur.enabled && motionBlur.shutter > 0;
      const descriptorSampleCount = motionBlurEnabled
        ? resolveRotoMotionBlurPreviewSamples(motionBlur.samples, {
            interactivePreviewEnabled: isProxyNode,
            interactivePreviewActive: isProxyNode,
            interactivePreviewSamples: sampleLimit,
          })
        : 1;
      const entry = rotoMaskTexturesRef.current.get(node.id);
      const needsResize =
        !entry || entry.width !== rasterSize.width || entry.height !== rasterSize.height;
      // When the viewer is ignoring alpha entirely, keep the last matte texture
      // until the interaction ends instead of burning time on invisible updates.
      const shouldReuseFrozenMask = suspendMaskUpdatesWhileEditing && isEditingNode && !!entry;

      if (shouldReuseFrozenMask) {
        nextMasks.set(node.id, entry);
        return;
      }

      const canReuse =
        entry &&
        !needsResize &&
        entry.node === node &&
        entry.frame === currentFrame &&
        entry.optimized === isProxyNode &&
        entry.motionBlurSampleCount === descriptorSampleCount &&
        entry.pointWeightMode === rotoPointWeightMode;
      if (canReuse) {
        nextMasks.set(node.id, entry);
        return;
      }

      if (
        entry &&
        entry.node === node &&
        entry.frame === currentFrame &&
        (entry.optimized !== isProxyNode ||
          entry.motionBlurSampleCount !== descriptorSampleCount ||
          entry.pointWeightMode !== rotoPointWeightMode)
      ) {
        requiresMediaUpdate = true;
      }
      const { textureCaches, textureCache } = getRotoTextureCache(
        entry,
        rasterSize.width,
        rasterSize.height,
      );
      const maskLayers = createRotoMaskLayers(node, sceneNode, currentFrame, {
        width: rasterSize.width,
        height: rasterSize.height,
        // The viewport compositor still renders at scene resolution, so feather
        // remains in scene pixels while the hard mask is temporarily lower-res.
        featherScale: 1,
        motionBlurSampleCount: descriptorSampleCount,
        pointWeightMode: rotoPointWeightMode,
        textureCache,
      });
      const nextEntry: RotoMaskEntry = {
        width: rasterSize.width,
        height: rasterSize.height,
        node,
        frame: currentFrame,
        optimized: isProxyNode,
        motionBlurSampleCount: descriptorSampleCount,
        pointWeightMode: rotoPointWeightMode,
        textureCaches,
        maskLayers,
        dispose: () => disposeRotoTextureCaches(textureCaches),
      };
      nextMasks.set(node.id, nextEntry);
    });

    rotoMaskTexturesRef.current.forEach((entry, id) => {
      if (!nextMasks.has(id)) {
        entry.dispose();
      }
    });

    rotoMaskTexturesRef.current = nextMasks;
    reportPrepareDuration?.(performance.now() - prepareStartedAt);
    if (requiresMediaUpdate) bumpMediaUpdate();
  }, [
    nodes,
    currentFrame,
    sceneNode,
    viewportSize,
    optimizedPreviewActive,
    editingPreviewActive,
    editingNodeId,
    maxDimension,
    sampleLimit,
    rotoPointWeightMode,
    suspendMaskUpdatesWhileEditing,
    reportPrepareDuration,
    bumpMediaUpdate,
  ]);

  useLayoutEffect(() => {
    return () => {
      rotoMaskTexturesRef.current.forEach((entry) => {
        entry.dispose();
      });
      rotoMaskTexturesRef.current.clear();
    };
  }, []);

  return rotoMaskTexturesRef;
};
