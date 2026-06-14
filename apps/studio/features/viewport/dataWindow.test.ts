import { describe, expect, it } from 'vitest';
import {
  BlendMode,
  ImageFitMode,
  NodeType,
  type AnyNode,
  type ComfyNode,
  type GeneratedOutput,
  type ViewportPromptRegion,
} from '@blackboard/types';
import { getDataWindowProjection, getDataWindowRect, type DataWindowNode } from './dataWindow';

const scene = { width: 2048, height: 2490 };

const fittedSource: DataWindowNode = {
  width: 1024,
  height: 1245,
  transform: {
    x: 40,
    y: -20,
    scaleX: 1.5,
    scaleY: 1.25,
    fitMode: ImageFitMode.FIT,
  },
};

const makeComfyRegion = (
  id: string,
  rect: ViewportPromptRegion['rect'],
  visible = true,
): ViewportPromptRegion => ({
  id,
  rect,
  visible,
  prompt: '',
  bindings: [],
});

const makeComfyOutput = (updates: Partial<GeneratedOutput> = {}): GeneratedOutput => ({
  id: 'output_a',
  src: 'asset_a',
  mediaKind: 'image',
  colorSpace: 'sRGB',
  width: 100,
  height: 100,
  createdAt: 1,
  ...updates,
});

const makeComfyNode = (updates: Partial<ComfyNode> = {}): ComfyNode => ({
  id: 'comfy',
  type: NodeType.COMFY,
  name: 'Comfy',
  enabled: true,
  workflows: [],
  selectedWorkflowId: undefined,
  workflowControls: [],
  workflowInputImages: {},
  viewportPromptRegions: [],
  generatedOutputs: [],
  activeGeneratedOutputId: undefined,
  src: '',
  width: 800,
  height: 800,
  opacity: 100,
  operator: BlendMode.OVER,
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.FIT },
  colorSpace: 'sRGB',
  ...updates,
});

describe('getDataWindowRect', () => {
  it('uses the stored transform for normal source data windows', () => {
    expect(getDataWindowRect(scene, fittedSource, 0)).toEqual({
      x: 296,
      y: 486.875,
      width: 1536,
      height: 1556.25,
      nativeWidth: 1024,
      nativeHeight: 1245,
    });
  });

  it('uses the native bbox for match-output source data windows', () => {
    expect(getDataWindowRect(scene, { ...fittedSource, useOutputSizeAsScene: true }, 0)).toEqual({
      x: 512,
      y: 622.5,
      width: 1024,
      height: 1245,
      nativeWidth: 1024,
      nativeHeight: 1245,
    });
  });

  it('uses crop margins for crop node data windows', () => {
    expect(
      getDataWindowRect(
        scene,
        {
          crop: {
            left: 10,
            right: 30,
            top: 20,
            bottom: 40,
          },
        },
        0,
      ),
    ).toEqual({
      x: 10,
      y: 20,
      width: 2008,
      height: 2430,
      nativeWidth: 2048,
      nativeHeight: 2490,
    });
  });

  it('uses transform nodes to project the scene data window bbox', () => {
    expect(
      getDataWindowRect(
        { width: 100, height: 80 },
        {
          transform: {
            translateX: 10,
            translateY: -5,
            scaleX: 0.5,
            scaleY: 2,
            rotation: 0,
            pivotX: 0,
            pivotY: 0,
          },
        },
        0,
      ),
    ).toEqual({
      x: 35,
      y: -35,
      width: 50,
      height: 160,
      nativeWidth: 100,
      nativeHeight: 80,
    });
  });

  it('expands transform data window bboxes for rotation', () => {
    const rect = getDataWindowRect(
      { width: 100, height: 80 },
      {
        transform: {
          translateX: 0,
          translateY: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 90,
          pivotX: 0,
          pivotY: 0,
        },
      },
      0,
    );

    expect(rect.x).toBeCloseTo(10);
    expect(rect.y).toBeCloseTo(-10);
    expect(rect.width).toBeCloseTo(80);
    expect(rect.height).toBeCloseTo(100);
    expect(rect.nativeWidth).toBeCloseTo(100);
    expect(rect.nativeHeight).toBeCloseTo(80);
  });

  it('feeds downstream transform nodes from the upstream data window', () => {
    const nodes: AnyNode[] = [
      {
        id: 'scene',
        type: NodeType.SCENE,
        name: 'Scene',
        enabled: true,
        width: 100,
        height: 100,
        fps: 24,
        duration: 100,
        colorSpace: 'sRGB',
        bitDepth: 16,
        maxFrames: 100,
      } as AnyNode,
      {
        id: 'image',
        type: NodeType.MEDIA_SOURCE,
        name: 'Image',
        enabled: true,
        mediaKind: 'image',
        src: '',
        width: 80,
        height: 80,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
        opacity: 100,
      } as AnyNode,
      {
        id: 'crop',
        type: NodeType.CROP,
        name: 'Crop',
        enabled: true,
        crop: { left: 20, right: 0, top: 0, bottom: 0 },
      } as AnyNode,
      {
        id: 'transform',
        type: NodeType.TRANSFORM,
        name: 'Transform',
        enabled: true,
        transform: {
          translateX: 0,
          translateY: 0,
          scaleX: 2,
          scaleY: 2,
          rotation: 0,
          pivotX: 0,
          pivotY: 0,
        },
      } as AnyNode,
    ];

    const projection = getDataWindowProjection({ width: 100, height: 100 }, nodes, 0);
    const input = projection.inputs.get('transform');
    const output = projection.outputs.get('transform');

    expect(input).toEqual({
      x: 20,
      y: 10,
      width: 70,
      height: 80,
      nativeWidth: 80,
      nativeHeight: 80,
    });
    expect(output).toEqual({
      x: -10,
      y: -30,
      width: 140,
      height: 160,
      nativeWidth: 70,
      nativeHeight: 80,
    });
  });

  it('uses explicit pipe inputs when projecting transform data windows', () => {
    const nodes: AnyNode[] = [
      {
        id: 'scene',
        type: NodeType.SCENE,
        name: 'Scene',
        enabled: true,
        width: 100,
        height: 100,
        fps: 24,
        duration: 100,
        colorSpace: 'sRGB',
        bitDepth: 16,
        maxFrames: 100,
      } as AnyNode,
      {
        id: 'image-a',
        type: NodeType.MEDIA_SOURCE,
        name: 'Image A',
        enabled: true,
        mediaKind: 'image',
        src: '',
        width: 80,
        height: 80,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
        opacity: 100,
      } as AnyNode,
      {
        id: 'image-b',
        type: NodeType.MEDIA_SOURCE,
        name: 'Image B',
        enabled: true,
        mediaKind: 'image',
        src: '',
        width: 20,
        height: 20,
        transform: { x: 30, y: 30, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.NONE },
        opacity: 100,
      } as AnyNode,
      {
        id: 'transform',
        type: NodeType.TRANSFORM,
        name: 'Transform',
        enabled: true,
        inputs: { pipe: 'image-b' },
        transform: {
          translateX: 0,
          translateY: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          pivotX: 0,
          pivotY: 0,
        },
      } as AnyNode,
    ];

    const projection = getDataWindowProjection({ width: 100, height: 100 }, nodes, 0);

    expect(projection.inputs.get('transform')).toEqual({
      x: 70,
      y: 10,
      width: 20,
      height: 20,
      nativeWidth: 20,
      nativeHeight: 20,
    });
    expect(projection.outputs.get('transform')).toEqual({
      x: 70,
      y: 10,
      width: 20,
      height: 20,
      nativeWidth: 20,
      nativeHeight: 20,
    });
  });

  it('uses visible Comfy generated outputs as the Comfy data window', () => {
    const comfyNode = makeComfyNode({
      width: 900,
      height: 900,
      viewportPromptRegions: [
        makeComfyRegion('region_a', { x: 100, y: 100, width: 200, height: 100 }),
        makeComfyRegion('region_b', { x: 700, y: 600, width: 100, height: 200 }),
        makeComfyRegion('hidden_region', { x: 0, y: 0, width: 1000, height: 1000 }, false),
      ],
      generatedOutputs: [
        makeComfyOutput({
          id: 'region_a_old',
          src: 'asset_old',
          regionId: 'region_a',
          width: 400,
          height: 200,
          visible: false,
        }),
        makeComfyOutput({
          id: 'region_a_active',
          src: 'asset_a',
          regionId: 'region_a',
          width: 400,
          height: 200,
          visible: true,
        }),
        makeComfyOutput({
          id: 'region_b_active',
          src: 'asset_b',
          regionId: 'region_b',
          width: 100,
          height: 200,
          transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.STRETCH },
          visible: true,
        }),
        makeComfyOutput({
          id: 'hidden_region_output',
          src: 'asset_hidden',
          regionId: 'hidden_region',
          width: 1000,
          height: 1000,
          visible: true,
        }),
      ],
    });

    const projection = getDataWindowProjection({ width: 1000, height: 1000 }, [comfyNode], 0);

    expect(projection.outputs.get('comfy')).toEqual({
      x: 100,
      y: 100,
      width: 700,
      height: 700,
      nativeWidth: 700,
      nativeHeight: 700,
    });
  });

  it('keeps hidden Comfy generated outputs from falling back to stale node dimensions', () => {
    const comfyNode = makeComfyNode({
      width: 900,
      height: 900,
      generatedOutputs: [
        makeComfyOutput({
          id: 'hidden_output',
          src: 'asset_hidden',
          width: 120,
          height: 120,
          visible: false,
        }),
      ],
    });

    const projection = getDataWindowProjection({ width: 1000, height: 1000 }, [comfyNode], 0);

    expect(projection.outputs.get('comfy')).toEqual({
      x: 0,
      y: 0,
      width: 1000,
      height: 1000,
      nativeWidth: 1000,
      nativeHeight: 1000,
    });
  });
});
