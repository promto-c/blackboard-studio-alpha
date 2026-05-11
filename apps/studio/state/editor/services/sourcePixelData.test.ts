import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlendMode, ImageFitMode, NodeType, type AnyNode } from '@blackboard/types';
import { MEDIA_SOURCE_UPSTREAM } from '@/utils/mediaSourceSelection';

const { getPixelDataForFrameMock, renderWithSharedPipelineMock } = vi.hoisted(() => ({
  getPixelDataForFrameMock: vi.fn(),
  renderWithSharedPipelineMock: vi.fn(),
}));

const originalDocument = globalThis.document;

vi.mock('./pixelData', () => ({
  getPixelDataForFrame: getPixelDataForFrameMock,
}));

vi.mock('@/renderer/pipeline', () => ({
  renderWithSharedPipeline: renderWithSharedPipelineMock,
}));

import {
  createSourcePixelDataReader,
  getSourcePixelDataForFrame,
  resolveSourcePixelSource,
} from './sourcePixelData';

const SCENE_NODE: AnyNode = {
  id: 'scene',
  type: NodeType.SCENE,
  name: 'Scene',
  visible: true,
  width: 2,
  height: 2,
  bitDepth: 16,
  colorSpace: 'Linear',
  maxFrames: 0,
  fps: 30,
};

const IMAGE_NODE: AnyNode = {
  id: 'img-1',
  type: NodeType.IMAGE,
  name: 'Plate',
  visible: true,
  src: 'plate',
  width: 2,
  height: 2,
  opacity: 100,
  operator: BlendMode.OVER,
  colorSpace: 'sRGB',
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
};

const GRADE_NODE: AnyNode = {
  id: 'grade-1',
  type: NodeType.GRADE,
  name: 'Look',
  visible: true,
  stacked: true,
  grade: {
    brightness: 0,
    contrast: 1,
    saturation: 1,
    gain: 1,
    gamma: 1,
  },
};

const ROTO_NODE: AnyNode = {
  id: 'roto-1',
  type: NodeType.ROTO,
  name: 'Roto',
  visible: true,
  invert: false,
  paths: [],
};

afterEach(() => {
  getPixelDataForFrameMock.mockReset();
  renderWithSharedPipelineMock.mockReset();
  globalThis.document = originalDocument;
});

describe('sourcePixelData', () => {
  it('collapses upstream to the raw media source when it is already a single source node', () => {
    const nodes = [SCENE_NODE, IMAGE_NODE, ROTO_NODE];

    expect(resolveSourcePixelSource(nodes, 'roto-1', MEDIA_SOURCE_UPSTREAM)).toEqual({
      kind: 'media-node',
      node: IMAGE_NODE,
    });
  });

  it('resolves the upstream source to the nodes before the roto node', () => {
    const nodes = [SCENE_NODE, IMAGE_NODE, GRADE_NODE, ROTO_NODE];

    expect(resolveSourcePixelSource(nodes, 'roto-1', MEDIA_SOURCE_UPSTREAM)).toEqual({
      kind: 'upstream',
      nodes: [SCENE_NODE, IMAGE_NODE, GRADE_NODE],
      sceneNode: SCENE_NODE,
    });
  });

  it('delegates media-node sources to the raw pixel loader', async () => {
    const pixelData = {
      data: new Uint8ClampedArray([1, 2, 3, 4]),
      width: 1,
      height: 1,
    };
    getPixelDataForFrameMock.mockResolvedValue(pixelData);

    const result = await getSourcePixelDataForFrame(
      {
        kind: 'media-node',
        node: IMAGE_NODE as typeof IMAGE_NODE & {
          type: typeof NodeType.IMAGE;
        },
      },
      12,
      24,
    );

    expect(result).toBe(pixelData);
    expect(getPixelDataForFrameMock).toHaveBeenCalledWith(IMAGE_NODE, 12, 24);
  });

  it('reads upstream render targets and flips them to match canvas pixel orientation', async () => {
    const dispose = vi.fn();
    const scratchCanvas = { width: 0, height: 0 } as HTMLCanvasElement;
    const readRenderTargetPixels = vi.fn(
      (
        _renderTarget: THREE.WebGLRenderTarget,
        _x: number,
        _y: number,
        _width: number,
        _height: number,
        buffer: Uint8Array,
      ) => {
        buffer.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
      },
    );
    globalThis.document = {
      createElement: vi.fn(() => scratchCanvas),
    } as unknown as Document;

    renderWithSharedPipelineMock.mockResolvedValue({
      renderer: { readRenderTargetPixels },
      finalOutputTarget: {
        width: 2,
        height: 2,
        texture: { type: THREE.UnsignedByteType },
      },
      dispose,
    });

    const result = await getSourcePixelDataForFrame(
      {
        kind: 'upstream',
        nodes: [SCENE_NODE, IMAGE_NODE, GRADE_NODE],
        sceneNode: SCENE_NODE as typeof SCENE_NODE & {
          type: typeof NodeType.SCENE;
        },
      },
      5,
      30,
    );

    expect(renderWithSharedPipelineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        captureFinalOutput: true,
        nodes: [SCENE_NODE, IMAGE_NODE, GRADE_NODE],
        sceneNode: SCENE_NODE,
        frame: 5,
        width: 2,
        height: 2,
        finalColorSpace: 'srgb',
        textureCacheMode: 'persistent',
        keepRendererAlive: true,
        presentToCanvas: false,
      }),
    );
    expect(result).toEqual({
      data: new Uint8ClampedArray([9, 10, 11, 12, 13, 14, 15, 16, 1, 2, 3, 4, 5, 6, 7, 8]),
      width: 2,
      height: 2,
    });
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

it('reuses the upstream renderer across frames and disposes it once per session', async () => {
  const renderer = {
    readRenderTargetPixels: vi.fn(
      (
        _renderTarget: THREE.WebGLRenderTarget,
        _x: number,
        _y: number,
        _width: number,
        _height: number,
        buffer: Uint8Array,
      ) => buffer.fill(0),
    ),
    dispose: vi.fn(),
  };
  renderWithSharedPipelineMock
    .mockResolvedValueOnce({
      renderer,
      finalOutputTarget: {
        width: 1,
        height: 1,
        texture: { type: THREE.UnsignedByteType },
      },
      dispose: vi.fn(),
    })
    .mockResolvedValueOnce({
      renderer,
      finalOutputTarget: {
        width: 1,
        height: 1,
        texture: { type: THREE.UnsignedByteType },
      },
      dispose: vi.fn(),
    });

  const reader = createSourcePixelDataReader(
    {
      kind: 'upstream',
      nodes: [SCENE_NODE, IMAGE_NODE, GRADE_NODE],
      sceneNode: SCENE_NODE as typeof SCENE_NODE & {
        type: typeof NodeType.SCENE;
      },
    },
    30,
  );

  await reader.getFramePixelData(1);
  await reader.getFramePixelData(2);
  reader.dispose();

  expect(renderWithSharedPipelineMock).toHaveBeenCalledTimes(2);
  expect(renderWithSharedPipelineMock.mock.calls[0][0].renderer).toBeUndefined();
  expect(renderWithSharedPipelineMock.mock.calls[1][0].renderer).toBe(renderer);
  expect(renderer.dispose).toHaveBeenCalledTimes(1);
});
