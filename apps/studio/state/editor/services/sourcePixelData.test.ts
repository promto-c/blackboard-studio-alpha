import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlendMode, ImageFitMode, NodeType, type AnyNode } from '@blackboard/types';
import { ColorManagementDefaults } from '@/color-management/constants';
import { colorManagementService, createDefaultProjectColorManagement } from '@/color-management';
import { createDefaultGrade } from '@/nodes/effects/grade/gradeModel';
import { MEDIA_SOURCE_UPSTREAM } from '@/utils/mediaSourceSelection';

const { createPixelDataReaderMock, getPixelDataForFrameMock, renderWithSharedPipelineMock } =
  vi.hoisted(() => ({
    createPixelDataReaderMock: vi.fn(),
    getPixelDataForFrameMock: vi.fn(),
    renderWithSharedPipelineMock: vi.fn(),
  }));

vi.mock('./pixelData', () => ({
  createPixelDataReader: createPixelDataReaderMock,
  getPixelDataForFrame: getPixelDataForFrameMock,
}));

const originalDocument = globalThis.document;

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
  enabled: true,
  width: 2,
  height: 2,
  bitDepth: 16,
  colorSpace: ColorManagementDefaults.WORKING_SPACE,
  startFrame: 0,
  maxFrames: 0,
  fps: 30,
};

const IMAGE_NODE: AnyNode = {
  id: 'img-1',
  type: NodeType.MEDIA_SOURCE,
  mediaKind: 'image',
  name: 'Plate',
  enabled: true,
  src: 'plate',
  width: 2,
  height: 2,
  opacity: 100,
  operator: BlendMode.OVER,
  colorSpace: ColorManagementDefaults.TEXTURE_SPACE,
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
};

const GRADE_NODE = {
  id: 'grade-1',
  type: NodeType.GRADE,
  name: 'Look',
  enabled: true,
  stacked: true,
  grade: createDefaultGrade(),
} as AnyNode;

const ROTO_NODE: AnyNode = {
  id: 'roto-1',
  type: NodeType.ROTO,
  name: 'Roto',
  enabled: true,
  invert: false,
  paths: [],
};
const PROJECT_COLOR_MANAGEMENT = createDefaultProjectColorManagement();

beforeEach(() => {
  vi.spyOn(colorManagementService, 'resolveProjectColorManagement').mockReturnValue({
    project: PROJECT_COLOR_MANAGEMENT,
    config: PROJECT_COLOR_MANAGEMENT.config,
    workingColorSpace: ColorManagementDefaults.WORKING_SPACE,
    textureColorSpace: ColorManagementDefaults.TEXTURE_SPACE,
    colorPickingColorSpace: ColorManagementDefaults.COLOR_PICKING_SPACE,
    dataColorSpace: ColorManagementDefaults.DATA_SPACE,
    display: PROJECT_COLOR_MANAGEMENT.viewer.display,
    view: PROJECT_COLOR_MANAGEMENT.viewer.view,
    look: PROJECT_COLOR_MANAGEMENT.viewer.look,
    context: {},
  });
});

afterEach(() => {
  createPixelDataReaderMock.mockReset();
  getPixelDataForFrameMock.mockReset();
  renderWithSharedPipelineMock.mockReset();
  vi.restoreAllMocks();
  globalThis.document = originalDocument;
});

describe('sourcePixelData', () => {
  it('collapses upstream to the raw media source when it is already a single source node', () => {
    const nodes = [SCENE_NODE, IMAGE_NODE, ROTO_NODE];

    expect(
      resolveSourcePixelSource(nodes, 'roto-1', MEDIA_SOURCE_UPSTREAM, PROJECT_COLOR_MANAGEMENT),
    ).toEqual({
      kind: 'media-node',
      node: IMAGE_NODE,
    });
  });

  it('resolves the upstream source to the nodes before the roto node', () => {
    const nodes = [SCENE_NODE, IMAGE_NODE, GRADE_NODE, ROTO_NODE];

    expect(
      resolveSourcePixelSource(nodes, 'roto-1', MEDIA_SOURCE_UPSTREAM, PROJECT_COLOR_MANAGEMENT),
    ).toEqual({
      kind: 'upstream',
      nodes: [SCENE_NODE, IMAGE_NODE, GRADE_NODE],
      sceneNode: SCENE_NODE,
      projectColorManagement: PROJECT_COLOR_MANAGEMENT,
    });
  });

  it('delegates media-node sources to the raw pixel loader', async () => {
    const pixelData = {
      data: new Uint8ClampedArray([1, 2, 3, 4]),
      width: 1,
      height: 1,
    };
    const getFramePixelData = vi.fn().mockResolvedValue(pixelData);
    const dispose = vi.fn();
    createPixelDataReaderMock.mockReturnValue({ getFramePixelData, dispose });

    const result = await getSourcePixelDataForFrame(
      {
        kind: 'media-node',
        node: IMAGE_NODE as typeof IMAGE_NODE & {
          type: typeof NodeType.MEDIA_SOURCE;
        },
      },
      12,
      24,
    );

    expect(result).toBe(pixelData);
    expect(createPixelDataReaderMock).toHaveBeenCalledWith(IMAGE_NODE, 24);
    expect(getFramePixelData).toHaveBeenCalledWith(12);
    expect(dispose).toHaveBeenCalledTimes(1);
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
        buffer: Float32Array,
      ) => {
        buffer.set(
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((value) => value / 255),
        );
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
        texture: { type: THREE.FloatType },
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
        projectColorManagement: PROJECT_COLOR_MANAGEMENT,
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

    await getSourcePixelDataForFrame(
      {
        kind: 'upstream',
        nodes: [SCENE_NODE, IMAGE_NODE, GRADE_NODE],
        sceneNode: SCENE_NODE as typeof SCENE_NODE & {
          type: typeof NodeType.SCENE;
        },
        projectColorManagement: PROJECT_COLOR_MANAGEMENT,
      },
      5,
      30,
      { finalColorSpace: 'scene_linear' },
    );
    expect(renderWithSharedPipelineMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ finalColorSpace: 'scene_linear' }),
    );
    expect(dispose).toHaveBeenCalledTimes(2);
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
        buffer: Float32Array,
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
        texture: { type: THREE.FloatType },
      },
      dispose: vi.fn(),
    })
    .mockResolvedValueOnce({
      renderer,
      finalOutputTarget: {
        width: 1,
        height: 1,
        texture: { type: THREE.FloatType },
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
      projectColorManagement: PROJECT_COLOR_MANAGEMENT,
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
