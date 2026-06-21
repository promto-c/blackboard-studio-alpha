import * as THREE from 'three';
import { getValueAtFrame, type RendererMaskLayer } from '@blackboard/renderer';
import {
  NodeType,
  RotoPathBlend,
  type AnyNode,
  type RotoNode,
  type SceneNode,
} from '@blackboard/types';
import {
  getRotoLayerMap,
  getRotoPathParentLayerId,
  getVisibleRotoPaths,
} from '@/utils/rotoHierarchy';
import { drawRotoPathGeometry } from '@/utils/rotoMaskRaster';
import {
  getRotoMotionBlurSampleFrames,
  getRotoMotionBlurSampleWeights,
  resolveRotoMotionBlurSettings,
} from '@/utils/rotoMotionBlur';

interface RotoMaskTextureBundle {
  layers: Map<string, RendererMaskLayer[]>;
  dispose: () => void;
}

const drawHardPathMask = (
  node: RotoNode,
  path: RotoNode['paths'][number],
  frame: number,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): void => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.fillStyle = 'white';
  ctx.strokeStyle = 'white';
  drawRotoPathGeometry(ctx, node, path, frame, canvas.width, canvas.height);
};

export const createMaskCanvas = (
  node: RotoNode,
  sceneNode: SceneNode,
  frame: number,
): HTMLCanvasElement | null => {
  const canvas = document.createElement('canvas');
  canvas.width = sceneNode.width;
  canvas.height = sceneNode.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const layerMap = getRotoLayerMap(node);
  const getBlendForPath = (path: RotoNode['paths'][number]) => {
    const parentLayerId = getRotoPathParentLayerId(node, path);
    const layer = parentLayerId ? layerMap.get(parentLayerId) : undefined;
    return layer?.blend ?? path.blend;
  };

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = node.invert ? 'white' : 'black';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const path of getVisibleRotoPaths(node)) {
    const opacity = getValueAtFrame(path.opacity, frame);
    if (opacity <= 0) continue;

    const feather = getValueAtFrame(path.feather, frame);
    const blend = getBlendForPath(path);

    ctx.save();
    ctx.globalAlpha = opacity / 100;
    if (node.invert) {
      ctx.globalCompositeOperation =
        blend === RotoPathBlend.ADD ? 'destination-out' : 'destination-in';
      ctx.fillStyle = 'black';
      ctx.strokeStyle = 'black';
    } else {
      ctx.globalCompositeOperation =
        blend === RotoPathBlend.SUBTRACT ? 'destination-out' : 'source-over';
      ctx.fillStyle = 'white';
      ctx.strokeStyle = 'white';
    }
    if (feather > 0) {
      ctx.filter = `blur(${feather}px)`;
    }

    drawRotoPathGeometry(ctx, node, path, frame, canvas.width, canvas.height);
    ctx.restore();
  }

  return canvas;
};

export const createRotoMaskTextureBundle = (
  nodes: AnyNode[],
  sceneNode: SceneNode,
  frame: number,
): RotoMaskTextureBundle => {
  const layers = new Map<string, RendererMaskLayer[]>();

  nodes.forEach((node) => {
    if (node.type !== NodeType.ROTO || !node.enabled) return;

    const rotoNode = node as RotoNode;
    {
      const layerMap = getRotoLayerMap(rotoNode);
      const motionBlur = resolveRotoMotionBlurSettings(rotoNode.motionBlur);
      const motionBlurEnabled = motionBlur.enabled && motionBlur.shutter > 0;
      const sampleFrames = motionBlurEnabled
        ? getRotoMotionBlurSampleFrames(
            frame,
            motionBlur.shutter,
            motionBlur.samples,
            motionBlur.phase,
          )
        : [frame];
      const sampleWeights = getRotoMotionBlurSampleWeights(sampleFrames.length);
      const maskLayers = getVisibleRotoPaths(rotoNode).flatMap((path) => {
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
        const samples = sampleFrames.flatMap((sampleFrame, sampleIndex) => {
          const clampedFrame = Math.max(0, Math.min(sceneNode.maxFrames, sampleFrame));
          const opacity = Math.max(
            0,
            Math.min(1, getValueAtFrame(path.opacity, clampedFrame) / 100),
          );
          if (opacity <= 0) return [];
          return [
            {
              texture,
              weight: sampleWeights[sampleIndex] * opacity,
              prepare: () => {
                drawHardPathMask(rotoNode, path, clampedFrame, pathCanvas, pathContext);
                texture.needsUpdate = true;
              },
            },
          ];
        });
        if (samples.length === 0) {
          texture.dispose();
          return [];
        }
        const parentLayerId = getRotoPathParentLayerId(rotoNode, path);
        const blend =
          (parentLayerId ? layerMap.get(parentLayerId)?.blend : undefined) ?? path.blend;
        return [
          {
            samples,
            feather: Math.max(0, getValueAtFrame(path.feather, frame)),
            opacity: 1,
            operation: blend === RotoPathBlend.SUBTRACT ? ('subtract' as const) : ('add' as const),
          },
        ];
      });
      layers.set(node.id, maskLayers);
    }
  });

  return {
    layers,
    dispose: () => {
      layers.forEach((maskLayers) =>
        new Set(
          maskLayers.flatMap((layer) => layer.samples.map((sample) => sample.texture)),
        ).forEach((texture) => texture.dispose()),
      );
    },
  };
};
