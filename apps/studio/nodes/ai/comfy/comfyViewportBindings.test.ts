import { describe, expect, it } from 'vitest';
import { NodeType, type ComfyNode } from '@blackboard/types';
import {
  applyComfyRootBindings,
  createComfyRootBindings,
  applyComfyViewportPromptRegionBindings,
  createComfyViewportBindings,
  createComfyViewportPromptRegion,
  createComfyViewportPromptRegionDeleteUpdate,
  getExplicitSelectedComfyViewportPromptRegion,
  getComfyRootControlSourceSummaries,
  getSelectedComfyViewportPromptRegion,
  getComfyViewportBindingTargetOptions,
  getComfyViewportControlSourceSummaries,
  shouldUseComfyWorkflowInputSource,
} from './comfyViewportBindings';

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
    '2': {
      class_type: 'CropImage',
      inputs: {
        x: 0,
        y: 0,
        image: ['4', 0],
      },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: 'old prompt',
      },
    },
    '4': {
      class_type: 'InpaintModelConditioning',
      inputs: {
        mask: null,
      },
    },
  },
};

describe('Comfy viewport bindings', () => {
  it('detects crop, latent size, and prompt workflow targets', () => {
    expect(getComfyViewportBindingTargetOptions(workflow, 'width')[0]).toMatchObject({
      nodeId: '1',
      inputName: 'width',
      classType: 'EmptyLatentImage',
    });
    expect(getComfyViewportBindingTargetOptions(workflow, 'x')[0]).toMatchObject({
      nodeId: '2',
      inputName: 'x',
      classType: 'CropImage',
    });
    expect(getComfyViewportBindingTargetOptions(workflow, 'prompt')[0]).toMatchObject({
      nodeId: '3',
      inputName: 'text',
      classType: 'CLIPTextEncode',
    });
    expect(getComfyViewportBindingTargetOptions(workflow, 'mask')[0]).toMatchObject({
      nodeId: '4',
      inputName: 'mask',
      classType: 'InpaintModelConditioning',
    });
  });

  it('does not treat unrelated numeric inputs as crop size targets', () => {
    const workflowWithDerivedSize = {
      id: 'workflow_derived_size',
      name: 'Workflow Derived Size',
      createdAt: 1,
      prompt: {
        '1': {
          class_type: 'EmptyLatentImage',
          inputs: {
            batch_size: 1,
          },
        },
        '2': {
          class_type: 'ImageScaleToTotalPixels',
          inputs: {
            image: ['3', 0],
          },
        },
      },
    };

    expect(getComfyViewportBindingTargetOptions(workflowWithDerivedSize, 'width')).toEqual([]);
    expect(getComfyViewportBindingTargetOptions(workflowWithDerivedSize, 'height')).toEqual([]);
  });

  it('applies selected crop region values without mutating the stored workflow prompt', () => {
    const node = {
      id: 'comfy_a',
      type: NodeType.COMFY,
      selectedWorkflowId: workflow.id,
      workflows: [workflow],
      selectedViewportPromptRegionId: 'region_a',
      viewportPromptRegions: [
        {
          id: 'region_a',
          rect: { x: 32, y: 48, width: 1024, height: 768 },
          prompt: 'rainy neon street',
          bindings: createComfyViewportBindings(workflow),
        },
      ],
    } as unknown as ComfyNode;

    const prompt = applyComfyViewportPromptRegionBindings(workflow.prompt, node, workflow);

    expect(prompt).toMatchObject({
      '1': { inputs: { width: 1024, height: 768 } },
      '2': { inputs: { x: 32, y: 48 } },
      '3': { inputs: { text: 'rainy neon street' } },
    });
    expect(workflow.prompt['1'].inputs.width).toBe(512);
    expect(workflow.prompt['3'].inputs.text).toBe('old prompt');
  });

  it('creates regions from crop tool defaults', () => {
    const region = createComfyViewportPromptRegion(
      workflow,
      { x: 8, y: 16, width: 320, height: 240 },
      {
        prompt: 'default region prompt',
        bindings: createComfyViewportBindings(workflow),
      },
    );

    expect(region.prompt).toBe('default region prompt');
    expect(Object.keys(region.bindings.find((binding) => binding.field === 'width') ?? {})).toEqual(
      ['id', 'field', 'target'],
    );
    expect(region.bindings.find((binding) => binding.field === 'height')?.target).toMatchObject({
      nodeId: '1',
      inputName: 'height',
    });
  });

  it('creates a clean update when deleting a viewport prompt region', () => {
    const node = {
      id: 'comfy_a',
      type: NodeType.COMFY,
      selectedWorkflowId: workflow.id,
      workflows: [workflow],
      selectedViewportPromptRegionId: 'region_a',
      activeGeneratedOutputId: 'output_a',
      viewportPromptRegions: [
        {
          id: 'region_a',
          rect: { x: 32, y: 48, width: 1024, height: 768 },
          prompt: 'rainy neon street',
          bindings: createComfyViewportBindings(workflow),
        },
        {
          id: 'region_b',
          rect: { x: 4, y: 8, width: 128, height: 96 },
          prompt: 'warm cafe',
          bindings: createComfyViewportBindings(workflow),
        },
      ],
      generatedOutputs: [
        { id: 'output_a', regionId: 'region_a' },
        { id: 'output_b', regionId: 'region_b' },
        { id: 'output_scene' },
      ],
    } as unknown as ComfyNode;

    const update = createComfyViewportPromptRegionDeleteUpdate(node, ['region_a']);

    expect(update).toMatchObject({
      activeGeneratedOutputId: undefined,
      selectedViewportPromptRegionId: 'region_b',
      viewportPromptRegions: [{ id: 'region_b' }],
      generatedOutputs: [{ id: 'output_b' }, { id: 'output_scene' }],
    });
  });

  it('falls back to the first visible viewport prompt region', () => {
    const node = {
      id: 'comfy_a',
      type: NodeType.COMFY,
      selectedWorkflowId: workflow.id,
      workflows: [workflow],
      selectedViewportPromptRegionId: undefined,
      viewportPromptRegions: [
        {
          id: 'region_hidden',
          visible: false,
          rect: { x: 32, y: 48, width: 1024, height: 768 },
          prompt: 'hidden',
          bindings: createComfyViewportBindings(workflow),
        },
        {
          id: 'region_visible',
          rect: { x: 4, y: 8, width: 128, height: 96 },
          prompt: 'visible',
          bindings: createComfyViewportBindings(workflow),
        },
      ],
    } as unknown as ComfyNode;

    expect(getSelectedComfyViewportPromptRegion(node)?.id).toBe('region_visible');
  });

  it('does not treat the fallback region as an explicit viewport selection', () => {
    const node = {
      id: 'comfy_a',
      type: NodeType.COMFY,
      selectedWorkflowId: workflow.id,
      workflows: [workflow],
      selectedViewportPromptRegionId: undefined,
      viewportPromptRegions: [
        {
          id: 'region_visible',
          rect: { x: 4, y: 8, width: 128, height: 96 },
          prompt: 'visible',
          bindings: createComfyViewportBindings(workflow),
        },
      ],
    } as unknown as ComfyNode;

    expect(getExplicitSelectedComfyViewportPromptRegion(node)).toBeNull();

    const prompt = applyComfyViewportPromptRegionBindings(workflow.prompt, node, workflow, {
      inputContext: 'viewportTool',
    });

    expect(prompt).toMatchObject({
      '1': { inputs: { width: 512, height: 512 } },
      '2': { inputs: { x: 0, y: 0 } },
      '3': { inputs: { text: 'old prompt' } },
    });
  });

  it('keeps context defaults on props values when run from the inspector', () => {
    const node = {
      id: 'comfy_a',
      type: NodeType.COMFY,
      selectedWorkflowId: workflow.id,
      workflows: [workflow],
      selectedViewportPromptRegionId: 'region_a',
      viewportPromptRegions: [
        {
          id: 'region_a',
          rect: { x: 32, y: 48, width: 1024, height: 768 },
          prompt: 'rainy neon street',
          bindings: createComfyViewportBindings(workflow),
        },
      ],
    } as unknown as ComfyNode;

    const prompt = applyComfyViewportPromptRegionBindings(workflow.prompt, node, workflow, {
      inputContext: 'props',
    });

    expect(prompt).toMatchObject({
      '1': { inputs: { width: 512, height: 512 } },
      '2': { inputs: { x: 0, y: 0 } },
      '3': { inputs: { text: 'old prompt' } },
    });
  });

  it('leaves explicitly unbound viewport fields on workflow values', () => {
    const bindings = createComfyViewportBindings(workflow).map((binding) =>
      binding.field === 'width' ? { ...binding, target: undefined } : binding,
    );
    const node = {
      id: 'comfy_a',
      type: NodeType.COMFY,
      selectedWorkflowId: workflow.id,
      workflows: [workflow],
      selectedViewportPromptRegionId: 'region_a',
      viewportPromptRegions: [
        {
          id: 'region_a',
          rect: { x: 32, y: 48, width: 1024, height: 768 },
          prompt: 'rainy neon street',
          bindings,
        },
      ],
    } as unknown as ComfyNode;

    const prompt = applyComfyViewportPromptRegionBindings(workflow.prompt, node, workflow);

    expect(prompt).toMatchObject({
      '1': { inputs: { width: 512, height: 768 } },
      '2': { inputs: { x: 32, y: 48 } },
      '3': { inputs: { text: 'rainy neon street' } },
    });
  });

  it('applies root size bindings from the scene when run from props', () => {
    const node = {
      id: 'comfy_a',
      type: NodeType.COMFY,
      width: 640,
      height: 480,
      selectedWorkflowId: workflow.id,
      workflows: [workflow],
      rootBindings: [
        {
          id: 'root_width',
          field: 'width',
          target: getComfyViewportBindingTargetOptions(workflow, 'width')[0],
        },
        {
          id: 'root_height',
          field: 'height',
          target: getComfyViewportBindingTargetOptions(workflow, 'height')[0],
        },
      ],
    } as unknown as ComfyNode;

    const prompt = applyComfyRootBindings(workflow.prompt, node, {
      width: 1920,
      height: 1080,
    });

    expect(prompt).toMatchObject({
      '1': { inputs: { width: 1920, height: 1080 } },
    });
    expect(workflow.prompt['1'].inputs.width).toBe(512);
    expect(workflow.prompt['1'].inputs.height).toBe(512);
  });

  it('creates default root size bindings for workflow width and height targets', () => {
    expect(createComfyRootBindings(workflow)).toMatchObject([
      {
        field: 'width',
        target: {
          nodeId: '1',
          inputName: 'width',
          classType: 'EmptyLatentImage',
        },
      },
      {
        field: 'height',
        target: {
          nodeId: '1',
          inputName: 'height',
          classType: 'EmptyLatentImage',
        },
      },
    ]);
  });

  it('leaves explicitly unbound root size fields on workflow values', () => {
    const rootBindings = createComfyRootBindings(workflow).map((binding) =>
      binding.field === 'width' ? { ...binding, target: undefined } : binding,
    );
    const node = {
      id: 'comfy_a',
      type: NodeType.COMFY,
      width: 640,
      height: 480,
      selectedWorkflowId: workflow.id,
      workflows: [workflow],
      rootBindings,
    } as unknown as ComfyNode;

    const prompt = applyComfyRootBindings(workflow.prompt, node, {
      width: 1920,
      height: 1080,
    });

    expect(prompt).toMatchObject({
      '1': { inputs: { width: 512, height: 1080 } },
    });
  });

  it('uses default root size bindings for older nodes without saved root bindings', () => {
    const node = {
      id: 'comfy_a',
      type: NodeType.COMFY,
      width: 640,
      height: 480,
      selectedWorkflowId: workflow.id,
      workflows: [workflow],
      rootBindings: undefined,
    } as unknown as ComfyNode;

    const prompt = applyComfyRootBindings(
      workflow.prompt,
      node,
      {
        width: 1920,
        height: 1080,
      },
      workflow,
    );

    expect(prompt).toMatchObject({
      '1': { inputs: { width: 1920, height: 1080 } },
    });
  });

  it('reports source labels for bound workflow controls', () => {
    const node = {
      id: 'comfy_a',
      type: NodeType.COMFY,
      selectedWorkflowId: workflow.id,
      workflows: [workflow],
      selectedViewportPromptRegionId: 'region_a',
      viewportPromptRegions: [
        {
          id: 'region_a',
          rect: { x: 32, y: 48, width: 1024, height: 768 },
          prompt: 'rainy neon street',
          bindings: createComfyViewportBindings(workflow),
        },
      ],
    } as unknown as ComfyNode;

    const summaries = getComfyViewportControlSourceSummaries(node, workflow);

    expect(summaries['1:width']).toEqual({ label: 'Region', value: 1024 });
    expect(summaries['3:text']).toEqual({ label: 'Region Prompt', value: 'rainy neon street' });

    expect(
      getComfyViewportControlSourceSummaries(node, workflow, { inputContext: 'props' }),
    ).toEqual({});
  });

  it('reports root size source labels for bound workflow controls', () => {
    const node = {
      id: 'comfy_a',
      type: NodeType.COMFY,
      width: 640,
      height: 480,
      selectedWorkflowId: workflow.id,
      workflows: [workflow],
      rootBindings: [
        {
          id: 'root_width',
          field: 'width',
          target: getComfyViewportBindingTargetOptions(workflow, 'width')[0],
        },
        {
          id: 'root_height',
          field: 'height',
          target: getComfyViewportBindingTargetOptions(workflow, 'height')[0],
        },
      ],
    } as unknown as ComfyNode;

    expect(
      getComfyRootControlSourceSummaries(node, workflow, { width: 1920, height: 1080 }),
    ).toEqual({
      '1:width': { label: 'Scene', value: 1920 },
      '1:height': { label: 'Scene', value: 1080 },
    });
  });

  it('respects app-input workflow bindings for image candidates', () => {
    const imageCandidate = getComfyViewportBindingTargetOptions(workflow, 'mask')[0];
    expect(imageCandidate).toMatchObject({ kind: 'workflowInput' });

    const node = {
      id: 'comfy_a',
      type: NodeType.COMFY,
      selectedWorkflowId: workflow.id,
      workflows: [workflow],
      selectedViewportPromptRegionId: 'region_a',
      viewportPromptRegions: [
        {
          id: 'region_a',
          rect: { x: 32, y: 48, width: 1024, height: 768 },
          prompt: 'rainy neon street',
          bindings: createComfyViewportBindings(workflow),
        },
      ],
    } as unknown as ComfyNode;

    expect(
      shouldUseComfyWorkflowInputSource({
        node,
        workflow,
        candidate: {
          id: '4:mask',
          nodeId: '4',
          nodeType: 'InpaintModelConditioning',
          inputName: 'mask',
          label: 'InpaintModelConditioning #4',
        },
        inputContext: 'props',
      }),
    ).toBe(true);
  });
});
