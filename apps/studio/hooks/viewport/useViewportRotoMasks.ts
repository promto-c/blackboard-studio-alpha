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
import { resolveViewportRotoMaskRasterSize } from '@/utils/rotoPreviewQuality';

interface RotoMaskEntry {
  width: number;
  height: number;
  node: RotoNode;
  frame: number;
  interactive: boolean;
  motionBlurSampleCount: number;
  pointWeightMode: RotoPointWeightMode;
  textureCache: Map<string, THREE.CanvasTexture>;
  maskLayers: RendererMaskLayer[];
  dispose: () => void;
}

interface UseViewportRotoMasksOptions {
  nodes: AnyNode[];
  sceneNode?: SceneNode;
  viewportSize: { width: number; height: number };
  currentFrame: number;
  interactiveMotionBlurPreviewEnabled: boolean;
  interactiveMotionBlurPreviewActive: boolean;
  interactiveNodeId: string | null;
  interactiveMaxDimension: number;
  interactiveMotionBlurPreviewSamples: number;
  temporalPreviewActive?: boolean;
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
  interactiveMotionBlurPreviewEnabled,
  interactiveMotionBlurPreviewActive,
  interactiveNodeId,
  interactiveMaxDimension,
  interactiveMotionBlurPreviewSamples,
  temporalPreviewActive = false,
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
      const isInteractiveNode =
        interactiveMotionBlurPreviewEnabled &&
        interactiveMotionBlurPreviewActive &&
        node.id === interactiveNodeId;
      const isProxyNode = isInteractiveNode || temporalPreviewActive;
      const rasterSize = resolveViewportRotoMaskRasterSize(
        sceneNode,
        viewportSize,
        isProxyNode,
        interactiveMaxDimension,
      );
      const motionBlur = resolveRotoMotionBlurSettings(node.motionBlur);
      const motionBlurEnabled = motionBlur.enabled && motionBlur.shutter > 0;
      const descriptorSampleCount = motionBlurEnabled
        ? resolveRotoMotionBlurPreviewSamples(motionBlur.samples, {
            interactivePreviewEnabled: isProxyNode,
            interactivePreviewActive: isProxyNode,
            interactivePreviewSamples: interactiveMotionBlurPreviewSamples,
          })
        : 1;
      const entry = rotoMaskTexturesRef.current.get(node.id);
      const needsResize =
        !entry || entry.width !== rasterSize.width || entry.height !== rasterSize.height;
      // When the viewer is ignoring alpha entirely, keep the last matte texture
      // until the interaction ends instead of burning time on invisible updates.
      const shouldReuseFrozenMask = suspendMaskUpdatesWhileEditing && isInteractiveNode && !!entry;

      if (shouldReuseFrozenMask) {
        nextMasks.set(node.id, entry);
        return;
      }

      const canReuse =
        entry &&
        !needsResize &&
        entry.node === node &&
        entry.frame === currentFrame &&
        entry.interactive === isProxyNode &&
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
        (entry.interactive !== isProxyNode ||
          entry.motionBlurSampleCount !== descriptorSampleCount ||
          entry.pointWeightMode !== rotoPointWeightMode)
      ) {
        requiresMediaUpdate = true;
      }
      const textureCache =
        entry && !needsResize ? entry.textureCache : new Map<string, THREE.CanvasTexture>();
      if (entry && needsResize) {
        entry.dispose();
      }
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
        interactive: isProxyNode,
        motionBlurSampleCount: descriptorSampleCount,
        pointWeightMode: rotoPointWeightMode,
        textureCache,
        maskLayers,
        dispose: () => textureCache.forEach((texture) => texture.dispose()),
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
    interactiveMotionBlurPreviewEnabled,
    interactiveMotionBlurPreviewActive,
    interactiveNodeId,
    interactiveMaxDimension,
    interactiveMotionBlurPreviewSamples,
    temporalPreviewActive,
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
