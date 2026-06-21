import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import type { RendererMaskLayer } from '@blackboard/renderer';
import {
  NodeType,
  RotoPathBlend,
  type AnyNode,
  type RotoNode,
  type SceneNode,
} from '@blackboard/types';
import { getValueAtFrame } from '@blackboard/renderer';
import {
  getVisibleRotoPaths,
  getRotoLayerMap,
  getRotoPathParentLayerId,
} from '@/utils/rotoHierarchy';
import { drawRotoPathGeometry } from '@/utils/rotoMaskRaster';
import {
  getRotoMotionBlurSampleFrames,
  getRotoMotionBlurSampleWeights,
  resolveRotoMotionBlurPreviewSamples,
  resolveRotoMotionBlurSettings,
} from '@/utils/rotoMotionBlur';
import { DEFAULT_ROTO_POINT_WEIGHT_MODE, type RotoPointWeightMode } from '@/utils/rotoPointWeights';

interface RotoMaskEntry {
  width: number;
  height: number;
  maskLayers?: RendererMaskLayer[];
  dispose: () => void;
}

interface UseViewportRotoMasksOptions {
  nodes: AnyNode[];
  sceneNode?: SceneNode;
  currentFrame: number;
  interactiveMotionBlurPreviewEnabled: boolean;
  interactiveMotionBlurPreviewActive: boolean;
  interactiveMotionBlurPreviewSamples: number;
  rotoPointWeightMode: RotoPointWeightMode;
  suspendMaskUpdatesWhileEditing: boolean;
  bumpMediaUpdate: () => void;
}

const disposeMaskLayers = (layers: readonly RendererMaskLayer[] | undefined): void => {
  const textures = new Set(
    layers?.flatMap((layer) => layer.samples.map((sample) => sample.texture)),
  );
  textures.forEach((texture) => texture.dispose());
};

const disposeMaskEntry = (entry: RotoMaskEntry): void => {
  disposeMaskLayers(entry.maskLayers);
};

export const useViewportRotoMasks = ({
  nodes,
  sceneNode,
  currentFrame,
  interactiveMotionBlurPreviewEnabled,
  interactiveMotionBlurPreviewActive,
  interactiveMotionBlurPreviewSamples,
  rotoPointWeightMode,
  suspendMaskUpdatesWhileEditing,
  bumpMediaUpdate,
}: UseViewportRotoMasksOptions) => {
  const rotoMaskTexturesRef = useRef<Map<string, RotoMaskEntry>>(new Map());
  const previousPointWeightModeRef = useRef<RotoPointWeightMode>(DEFAULT_ROTO_POINT_WEIGHT_MODE);
  const previousInteractivePreviewRef = useRef<{
    enabled: boolean;
    active: boolean;
    samples: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!sceneNode) return;

    const rotoNodes = nodes.filter(
      (node) => node.type === NodeType.ROTO && node.enabled,
    ) as RotoNode[];
    const nextMasks = new Map<string, RotoMaskEntry>();
    let didUpdate = false;

    if (
      previousPointWeightModeRef.current !== rotoPointWeightMode &&
      !suspendMaskUpdatesWhileEditing
    ) {
      didUpdate = true;
    }
    previousPointWeightModeRef.current = rotoPointWeightMode;

    const nextInteractivePreviewState = {
      enabled: interactiveMotionBlurPreviewEnabled,
      active: interactiveMotionBlurPreviewActive,
      samples: interactiveMotionBlurPreviewSamples,
    };
    if (
      previousInteractivePreviewRef.current &&
      (previousInteractivePreviewRef.current.enabled !== nextInteractivePreviewState.enabled ||
        previousInteractivePreviewRef.current.active !== nextInteractivePreviewState.active ||
        previousInteractivePreviewRef.current.samples !== nextInteractivePreviewState.samples) &&
      !suspendMaskUpdatesWhileEditing
    ) {
      didUpdate = true;
    }
    previousInteractivePreviewRef.current = nextInteractivePreviewState;

    rotoNodes.forEach((node) => {
      const visiblePaths = getVisibleRotoPaths(node);
      const layerMap = getRotoLayerMap(node);
      const getBlendForPath = (path: RotoNode['paths'][number]) => {
        const parentLayerId = getRotoPathParentLayerId(node, path);
        const layer = parentLayerId ? layerMap.get(parentLayerId) : undefined;
        return layer?.blend ?? path.blend;
      };
      let entry = rotoMaskTexturesRef.current.get(node.id);
      const needsResize =
        !entry || entry.width !== sceneNode.width || entry.height !== sceneNode.height;
      // When the viewer is ignoring alpha entirely, keep the last matte texture
      // until the interaction ends instead of burning time on invisible updates.
      const shouldReuseFrozenMask = suspendMaskUpdatesWhileEditing && !!entry && !needsResize;

      if (shouldReuseFrozenMask) {
        nextMasks.set(node.id, entry);
        return;
      }

      if (!entry || needsResize) {
        if (entry) {
          disposeMaskEntry(entry);
        }

        const nextEntry: RotoMaskEntry = {
          width: sceneNode.width,
          height: sceneNode.height,
          dispose: () => {
            disposeMaskEntry(nextEntry);
          },
        };
        entry = nextEntry;
        didUpdate = true;
      }

      const motionBlur = resolveRotoMotionBlurSettings(node.motionBlur);
      const motionBlurEnabled = motionBlur.enabled && motionBlur.shutter > 0;
      const maxFrame = Math.max(0, sceneNode.maxFrames ?? 0);

      disposeMaskLayers(entry.maskLayers);
      const descriptorSampleCount = motionBlurEnabled
        ? resolveRotoMotionBlurPreviewSamples(motionBlur.samples, {
            interactivePreviewEnabled: interactiveMotionBlurPreviewEnabled,
            interactivePreviewActive: interactiveMotionBlurPreviewActive,
            interactivePreviewSamples: interactiveMotionBlurPreviewSamples,
          })
        : 1;
      const descriptorFrames = motionBlurEnabled
        ? getRotoMotionBlurSampleFrames(
            currentFrame,
            motionBlur.shutter,
            descriptorSampleCount,
            motionBlur.phase,
          )
        : [currentFrame];
      const descriptorWeights = getRotoMotionBlurSampleWeights(descriptorFrames.length);
      entry.maskLayers = visiblePaths.flatMap((path) => {
        const pathCanvas = document.createElement('canvas');
        pathCanvas.width = sceneNode.width;
        pathCanvas.height = sceneNode.height;
        const pathContext = pathCanvas.getContext('2d');
        if (!pathContext) return [];
        const texture = new THREE.CanvasTexture(pathCanvas);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.colorSpace = THREE.NoColorSpace;
        const samples = descriptorFrames.flatMap((sampleFrame, sampleIndex) => {
          const clampedFrame = Math.max(0, Math.min(maxFrame, sampleFrame));
          const opacity = Math.max(
            0,
            Math.min(1, getValueAtFrame(path.opacity, clampedFrame) / 100),
          );
          if (opacity <= 0) return [];
          return [
            {
              texture,
              weight: descriptorWeights[sampleIndex] * opacity,
              prepare: () => {
                pathContext.setTransform(1, 0, 0, 1, 0, 0);
                pathContext.clearRect(0, 0, pathCanvas.width, pathCanvas.height);
                pathContext.globalAlpha = 1;
                pathContext.globalCompositeOperation = 'source-over';
                pathContext.filter = 'none';
                pathContext.fillStyle = 'white';
                pathContext.strokeStyle = 'white';
                drawRotoPathGeometry(
                  pathContext,
                  node,
                  path,
                  clampedFrame,
                  pathCanvas.width,
                  pathCanvas.height,
                  rotoPointWeightMode,
                );
                texture.needsUpdate = true;
              },
            },
          ];
        });
        if (samples.length === 0) {
          texture.dispose();
          return [];
        }
        return [
          {
            samples,
            feather: Math.max(0, getValueAtFrame(path.feather, currentFrame)),
            opacity: 1,
            operation:
              getBlendForPath(path) === RotoPathBlend.SUBTRACT
                ? ('subtract' as const)
                : ('add' as const),
          },
        ];
      });

      nextMasks.set(node.id, entry);
    });

    rotoMaskTexturesRef.current.forEach((entry, id) => {
      if (!nextMasks.has(id)) {
        entry.dispose();
        didUpdate = true;
      }
    });

    rotoMaskTexturesRef.current = nextMasks;
    if (didUpdate) bumpMediaUpdate();
  }, [
    nodes,
    currentFrame,
    sceneNode,
    interactiveMotionBlurPreviewEnabled,
    interactiveMotionBlurPreviewActive,
    interactiveMotionBlurPreviewSamples,
    rotoPointWeightMode,
    suspendMaskUpdatesWhileEditing,
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
