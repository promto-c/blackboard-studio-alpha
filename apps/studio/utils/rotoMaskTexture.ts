import * as THREE from 'three';
import {
  configureStraightAlphaTexture,
  getValueAtFrame,
  type RendererMaskLayer,
} from '@blackboard/renderer';
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
import { DEFAULT_ROTO_POINT_WEIGHT_MODE, type RotoPointWeightMode } from '@/utils/rotoPointWeights';

export interface RotoMaskTextureBundle {
  layers: Map<string, RendererMaskLayer[]>;
  dispose: () => void;
}

interface RotoMaskRasterOptions {
  width?: number;
  height?: number;
  featherScale?: number;
  motionBlurSampleCount?: number;
  pointWeightMode?: RotoPointWeightMode;
  textureCache?: Map<string, THREE.CanvasTexture>;
}

interface WeightedRotoSample {
  frame: number;
  weight: number;
}

const drawWeightedPathMask = (
  node: RotoNode,
  path: RotoNode['paths'][number],
  samples: readonly WeightedRotoSample[],
  sceneNode: SceneNode,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  pointWeightMode: RotoPointWeightMode,
): void => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'lighter';
  ctx.filter = 'none';
  ctx.fillStyle = 'white';
  ctx.strokeStyle = 'white';
  ctx.setTransform(
    canvas.width / Math.max(1, sceneNode.width),
    0,
    0,
    canvas.height / Math.max(1, sceneNode.height),
    0,
    0,
  );
  samples.forEach((sample) => {
    ctx.globalAlpha = sample.weight;
    drawRotoPathGeometry(
      ctx,
      node,
      path,
      sample.frame,
      sceneNode.width,
      sceneNode.height,
      pointWeightMode,
    );
  });
  ctx.globalAlpha = 1;
};

export const createMaskCanvas = (
  node: RotoNode,
  sceneNode: SceneNode,
  frame: number,
): HTMLCanvasElement | null => {
  const canvas = document.createElement('canvas');
  canvas.width = sceneNode.width;
  canvas.height = sceneNode.height;
  const context = canvas.getContext('2d');
  if (!context) return null;

  const layerMap = getRotoLayerMap(node);
  context.fillStyle = node.invert ? 'white' : 'black';
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (const path of getVisibleRotoPaths(node)) {
    const opacity = getValueAtFrame(path.opacity, frame);
    if (opacity <= 0) continue;

    const parentLayerId = getRotoPathParentLayerId(node, path);
    const blend = (parentLayerId ? layerMap.get(parentLayerId)?.blend : undefined) ?? path.blend;
    const feather = getValueAtFrame(path.feather, frame);

    context.save();
    context.globalAlpha = opacity / 100;
    if (node.invert) {
      context.globalCompositeOperation =
        blend === RotoPathBlend.ADD ? 'destination-out' : 'destination-in';
      context.fillStyle = 'black';
      context.strokeStyle = 'black';
    } else {
      context.globalCompositeOperation =
        blend === RotoPathBlend.SUBTRACT ? 'destination-out' : 'source-over';
      context.fillStyle = 'white';
      context.strokeStyle = 'white';
    }
    context.filter = feather > 0 ? `blur(${feather}px)` : 'none';
    drawRotoPathGeometry(context, node, path, frame, canvas.width, canvas.height);
    context.restore();
  }

  return canvas;
};

export const disposeRotoMaskLayers = (layers: readonly RendererMaskLayer[] | undefined): void => {
  const textures = new Set(layers?.map((layer) => layer.texture));
  textures.forEach((texture) => texture.dispose());
};

export const createRotoMaskLayers = (
  node: RotoNode,
  sceneNode: SceneNode,
  frame: number,
  options: RotoMaskRasterOptions = {},
): RendererMaskLayer[] => {
  const width = Math.max(1, Math.round(options.width ?? sceneNode.width));
  const height = Math.max(1, Math.round(options.height ?? sceneNode.height));
  const featherScale =
    options.featherScale ??
    Math.min(width / Math.max(1, sceneNode.width), height / Math.max(1, sceneNode.height));
  const pointWeightMode = options.pointWeightMode ?? DEFAULT_ROTO_POINT_WEIGHT_MODE;
  const layerMap = getRotoLayerMap(node);
  const motionBlur = resolveRotoMotionBlurSettings(node.motionBlur);
  const motionBlurEnabled = motionBlur.enabled && motionBlur.shutter > 0;
  const sampleFrames = motionBlurEnabled
    ? getRotoMotionBlurSampleFrames(
        frame,
        motionBlur.shutter,
        options.motionBlurSampleCount ?? motionBlur.samples,
        motionBlur.phase,
      )
    : [frame];
  const sampleWeights = getRotoMotionBlurSampleWeights(sampleFrames.length);
  const maxFrame = Math.max(0, sceneNode.maxFrames ?? 0);
  const retainedTextureIds = new Set<string>();

  const maskLayers = getVisibleRotoPaths(node).flatMap((path) => {
    const weightedSamples = sampleFrames.flatMap((sampleFrame, sampleIndex) => {
      const clampedFrame = Math.max(0, Math.min(maxFrame, sampleFrame));
      const opacity = Math.max(0, Math.min(1, getValueAtFrame(path.opacity, clampedFrame) / 100));
      if (opacity <= 0) return [];
      return [
        {
          frame: clampedFrame,
          weight: sampleWeights[sampleIndex] * opacity,
        },
      ];
    });
    if (weightedSamples.length === 0) {
      return [];
    }

    let texture = options.textureCache?.get(path.id);
    let pathCanvas = texture?.image as HTMLCanvasElement | undefined;
    if (pathCanvas && (pathCanvas.width !== width || pathCanvas.height !== height)) {
      texture?.dispose();
      options.textureCache?.delete(path.id);
      texture = undefined;
      pathCanvas = undefined;
    }
    if (!texture || !pathCanvas) {
      pathCanvas = document.createElement('canvas');
      pathCanvas.width = width;
      pathCanvas.height = height;
      texture = configureStraightAlphaTexture(new THREE.CanvasTexture(pathCanvas));
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      options.textureCache?.set(path.id, texture);
    }
    const pathContext = pathCanvas.getContext('2d');
    if (!pathContext) {
      if (!options.textureCache) texture.dispose();
      return [];
    }
    retainedTextureIds.add(path.id);

    const parentLayerId = getRotoPathParentLayerId(node, path);
    const blend = (parentLayerId ? layerMap.get(parentLayerId)?.blend : undefined) ?? path.blend;
    let needsPreparation = true;
    return [
      {
        texture,
        prepare: () => {
          if (!needsPreparation) return;
          drawWeightedPathMask(
            node,
            path,
            weightedSamples,
            sceneNode,
            pathCanvas,
            pathContext,
            pointWeightMode,
          );
          texture.needsUpdate = true;
          needsPreparation = false;
        },
        feather: Math.max(0, getValueAtFrame(path.feather, frame) * featherScale),
        opacity: 1,
        operation: blend === RotoPathBlend.SUBTRACT ? ('subtract' as const) : ('add' as const),
      },
    ];
  });

  options.textureCache?.forEach((texture, pathId) => {
    if (retainedTextureIds.has(pathId)) return;
    texture.dispose();
    options.textureCache?.delete(pathId);
  });

  return maskLayers;
};

export const createRotoMaskTextureBundle = (
  nodes: AnyNode[],
  sceneNode: SceneNode,
  frame: number,
  options: Pick<RotoMaskRasterOptions, 'width' | 'height' | 'featherScale'> = {},
): RotoMaskTextureBundle => {
  const layers = new Map<string, RendererMaskLayer[]>();

  nodes.forEach((node) => {
    if (node.type !== NodeType.ROTO || !node.enabled) return;
    layers.set(node.id, createRotoMaskLayers(node as RotoNode, sceneNode, frame, options));
  });

  return {
    layers,
    dispose: () => layers.forEach(disposeRotoMaskLayers),
  };
};
