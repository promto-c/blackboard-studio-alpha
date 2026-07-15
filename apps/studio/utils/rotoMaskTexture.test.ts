// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  NodeType,
  RotoDrawMode,
  RotoPathBlend,
  RotoShapeType,
  type RotoNode,
  type SceneNode,
} from '@blackboard/types';
import { createRotoMaskLayers, createRotoMaskTextureBundle } from './rotoMaskTexture';

const sceneNode: SceneNode = {
  id: 'scene',
  type: NodeType.SCENE,
  name: 'Scene',
  enabled: true,
  width: 3840,
  height: 2160,
  bitDepth: 16,
  colorSpace: 'Linear',
  startFrame: 0,
  maxFrames: 100,
  fps: 24,
};

const rotoNode: RotoNode = {
  id: 'roto',
  type: NodeType.ROTO,
  name: 'Roto',
  enabled: true,
  invert: false,
  paths: [
    {
      id: 'path',
      name: 'Path',
      shapeType: RotoShapeType.POLYGON,
      points: [
        { x: -100, y: -100 },
        { x: 100, y: -100 },
        { x: 100, y: 100 },
      ],
      closed: true,
      feather: 40,
      opacity: 100,
      blend: RotoPathBlend.ADD,
      style: { mode: RotoDrawMode.FILL, strokeWidth: 4 },
    },
  ],
  motionBlur: {
    enabled: true,
    shutter: 1,
    samples: 64,
  },
};

const createCanvasContext = () => {
  let globalAlpha = 1;
  const drawnAlphas: number[] = [];
  const context = {
    get globalAlpha() {
      return globalAlpha;
    },
    set globalAlpha(value: number) {
      globalAlpha = value;
    },
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(() => drawnAlphas.push(globalAlpha)),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  return { context, drawnAlphas };
};

describe('Roto mask texture resources', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('precomposites every weighted motion sample into one target-sized texture', () => {
    const { context, drawnAlphas } = createCanvasContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);

    const bundle = createRotoMaskTextureBundle([rotoNode], sceneNode, 50, {
      width: 96,
      height: 54,
    });
    const layer = bundle.layers.get(rotoNode.id)?.[0];
    const textureCanvas = layer?.texture.image as HTMLCanvasElement;

    expect(textureCanvas.width).toBe(96);
    expect(textureCanvas.height).toBe(54);
    expect(layer?.feather).toBe(1);

    layer?.prepare?.();
    expect(context.setTransform).toHaveBeenLastCalledWith(0.025, 0, 0, 0.025, 0, 0);
    expect(context.fill).toHaveBeenCalledTimes(64);
    expect(context.globalCompositeOperation).toBe('lighter');
    expect(drawnAlphas.reduce((sum, alpha) => sum + alpha, 0)).toBeCloseTo(1);
    expect(drawnAlphas[0]).toBeCloseTo(drawnAlphas[1] / 2);
    expect(drawnAlphas.at(-1)).toBeCloseTo(drawnAlphas.at(-2)! / 2);

    layer?.prepare?.();
    expect(context.fill).toHaveBeenCalledTimes(64);

    bundle.dispose();
  });

  it('reuses path textures across same-resolution interactive updates', () => {
    const { context } = createCanvasContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    const textureCache = new Map<string, THREE.CanvasTexture>();
    const options = { width: 1280, height: 720, textureCache };

    const firstLayers = createRotoMaskLayers(rotoNode, sceneNode, 50, options);
    const updatedLayers = createRotoMaskLayers(
      { ...rotoNode, paths: [...rotoNode.paths] },
      sceneNode,
      50,
      options,
    );

    expect(updatedLayers[0]?.texture).toBe(firstLayers[0]?.texture);
    textureCache.forEach((texture) => texture.dispose());
  });
});
