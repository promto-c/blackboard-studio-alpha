import { describe, expect, it } from 'vitest';
import {
  BlendMode,
  ImageFitMode,
  NodeType,
  type ComfyNode,
  type GeneratedOutput,
  type ViewportPromptRegion,
} from '@blackboard/types';
import { createComfyViewportBindings } from './comfyViewportBindings';
import {
  getComfyCompositeLayers,
  getComfyGeneratedOutputsForGalleryActivation,
  getComfyGeneratedOutputsForGalleryScope,
  getOrderedComfyGeneratedOutputs,
  getVisibleComfyGeneratedOutputs,
} from './comfyOutputLayers';

const workflow = {
  id: 'workflow_a',
  name: 'Workflow A',
  createdAt: 1,
  prompt: {
    '1': {
      class_type: 'EmptyLatentImage',
      inputs: {
        width: 512,
        height: 512,
      },
    },
  },
};

const makeRegion = (
  id: string,
  rect: ViewportPromptRegion['rect'],
  visible = true,
): ViewportPromptRegion => ({
  id,
  rect,
  visible,
  prompt: '',
  bindings: createComfyViewportBindings(workflow),
});

const makeOutput = (updates: Partial<GeneratedOutput> = {}): GeneratedOutput => ({
  id: 'output_a',
  src: 'asset_a',
  mediaKind: 'image',
  colorSpace: 'sRGB',
  width: 100,
  height: 100,
  createdAt: 1,
  ...updates,
});

const makeNode = (updates: Partial<ComfyNode> = {}): ComfyNode => ({
  id: 'comfy_a',
  name: 'Comfy',
  enabled: true,
  type: NodeType.COMFY,
  workflows: [workflow],
  selectedWorkflowId: workflow.id,
  workflowControls: [],
  workflowInputImages: {},
  selectedViewportPromptRegionId: 'region_a',
  viewportPromptRegions: [makeRegion('region_a', { x: 300, y: 100, width: 200, height: 100 })],
  generatedOutputs: [],
  src: '',
  width: 0,
  height: 0,
  opacity: 100,
  operator: BlendMode.OVER,
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.FIT },
  colorSpace: 'sRGB',
  ...updates,
});

describe('Comfy output layers', () => {
  it('scopes gallery outputs to one region and excludes deleted entries', () => {
    const node = makeNode({
      generatedOutputs: [
        makeOutput({ id: 'region_a_1', regionId: 'region_a' }),
        makeOutput({ id: 'region_a_deleted', regionId: 'region_a', deletedAt: 10 }),
        makeOutput({ id: 'region_b_1', regionId: 'region_b' }),
        makeOutput({ id: 'node_output', regionId: undefined }),
      ],
    });

    expect(
      getComfyGeneratedOutputsForGalleryScope(node, 'region_a').map((output) => output.id),
    ).toEqual(['region_a_1']);
    expect(getComfyGeneratedOutputsForGalleryScope(node).map((output) => output.id)).toEqual([
      'region_a_1',
      'region_b_1',
      'node_output',
    ]);
  });

  it('filters outputs hidden directly or through their region', () => {
    const node = makeNode({
      viewportPromptRegions: [
        makeRegion('visible_region', { x: 0, y: 0, width: 100, height: 100 }),
        makeRegion('hidden_region', { x: 0, y: 0, width: 100, height: 100 }, false),
      ],
      generatedOutputs: [
        makeOutput({ id: 'visible_output', src: 'asset_visible', regionId: 'visible_region' }),
        makeOutput({ id: 'hidden_output', src: 'asset_hidden', visible: false }),
        makeOutput({ id: 'region_hidden_output', src: 'asset_region', regionId: 'hidden_region' }),
      ],
    });

    expect(getVisibleComfyGeneratedOutputs(node).map((output) => output.id)).toEqual([
      'visible_output',
    ]);
  });

  it('shows the activated gallery output and hides only its region siblings', () => {
    const node = makeNode({
      viewportPromptRegions: [
        makeRegion('region_a', { x: 0, y: 0, width: 100, height: 100 }),
        makeRegion('region_b', { x: 100, y: 0, width: 100, height: 100 }),
      ],
    });
    const outputs = [
      makeOutput({ id: 'region_a_old', src: 'asset_old', regionId: 'region_a', visible: true }),
      makeOutput({ id: 'region_a_new', src: 'asset_new', regionId: 'region_a', visible: true }),
      makeOutput({ id: 'region_b_active', src: 'asset_b', regionId: 'region_b', visible: true }),
      makeOutput({ id: 'scene_output', src: 'asset_scene', visible: true }),
    ];

    const nextOutputs = getComfyGeneratedOutputsForGalleryActivation(
      { ...node, generatedOutputs: outputs },
      outputs[1],
    );

    expect(nextOutputs.map((output) => [output.id, output.visible])).toEqual([
      ['region_a_old', false],
      ['region_a_new', true],
      ['region_b_active', true],
      ['scene_output', true],
    ]);
  });

  it('orders visible outputs by region/output stack order for compositing', () => {
    const node = makeNode({
      viewportPromptRegions: [
        makeRegion('region_later', { x: 0, y: 0, width: 100, height: 100 }),
        makeRegion('region_first', { x: 0, y: 0, width: 100, height: 100 }),
      ].map((region, index) => ({
        ...region,
        stackOrder: index === 0 ? 2 : 0,
      })),
      generatedOutputs: [
        makeOutput({
          id: 'later_region_second',
          src: 'asset_later_2',
          regionId: 'region_later',
          stackOrder: 1,
        }),
        makeOutput({
          id: 'root_middle',
          src: 'asset_root',
          stackOrder: 1,
        }),
        makeOutput({
          id: 'first_region_output',
          src: 'asset_first',
          regionId: 'region_first',
          stackOrder: 0,
        }),
        makeOutput({
          id: 'later_region_first',
          src: 'asset_later_1',
          regionId: 'region_later',
          stackOrder: 0,
        }),
      ],
    });

    expect(getOrderedComfyGeneratedOutputs(node).map((output) => output.id)).toEqual([
      'first_region_output',
      'root_middle',
      'later_region_first',
      'later_region_second',
    ]);
    expect(getVisibleComfyGeneratedOutputs(node).map((output) => output.id)).toEqual([
      'first_region_output',
      'root_middle',
      'later_region_first',
      'later_region_second',
    ]);
    expect(
      getComfyCompositeLayers(node, 0, { width: 1000, height: 1000 }).map((layer) => layer.id),
    ).toEqual(['later_region_second', 'later_region_first', 'root_middle', 'first_region_output']);
  });

  it('composites generated outputs against the scene', () => {
    const node = makeNode({
      generatedOutputs: [makeOutput({ id: 'output_a', src: 'asset_a', width: 100, height: 100 })],
    });

    const layers = getComfyCompositeLayers(node, 0, { width: 1000, height: 1000 });

    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({
      id: 'output_a',
      textureKey: 'asset_a',
      assetId: 'asset_a',
      width: 100,
      height: 100,
    });
  });

  it('marks generated data outputs as data composite layers', () => {
    const node = makeNode({
      generatedOutputs: [
        makeOutput({
          id: 'depth_output',
          src: 'depth_asset',
          label: 'Depth.Z',
        }),
      ],
    });

    const layers = getComfyCompositeLayers(node, 0, { width: 1000, height: 1000 });

    expect(layers[0]).toMatchObject({
      id: 'depth_output',
      textureKey: 'depth_asset',
      isData: true,
    });
  });

  it('marks named workflow mask inputs as data composite layers', () => {
    const node = makeNode({
      workflowInputImages: {
        mask: {
          assetId: 'mask_asset',
          name: 'subject_matte.png',
          width: 100,
          height: 100,
          createdAt: 1,
        },
      },
    });

    expect(getComfyCompositeLayers(node, 0, { width: 1000, height: 1000 })[0]).toMatchObject({
      id: 'comfy_a:input:mask',
      isData: true,
    });
  });
});
