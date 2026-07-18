import { describe, expect, it } from 'vitest';
import {
  BlendMode,
  ImageFitMode,
  NodeType,
  type ComfyNode,
  type SceneNode,
} from '@blackboard/types';
import { getComfyOutputTransform } from './comfyOutputTransform';

const makeComfyNode = (): ComfyNode => {
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

  return {
    id: 'comfy_a',
    name: 'Comfy',
    enabled: true,
    type: NodeType.COMFY,
    workflows: [workflow],
    selectedWorkflowId: workflow.id,
    workflowControls: [],
    workflowInputImages: {},
    selectedViewportPromptRegionId: 'region_a',
    viewportPromptRegions: [],
    generatedOutputs: [],
    src: '',
    width: 0,
    height: 0,
    opacity: 100,
    operator: BlendMode.OVER,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.FIT },
    colorSpace: 'sRGB',
  };
};

const sceneNode = {
  id: 'scene',
  name: 'Scene',
  enabled: true,
  type: NodeType.SCENE,
  width: 1920,
  height: 1080,
} as SceneNode;

describe('Comfy output transform', () => {
  it('fits Comfy outputs to the scene', () => {
    const transform = getComfyOutputTransform({
      node: makeComfyNode(),
      output: { width: 960, height: 540 },
      sceneNode,
    });

    expect(transform).toMatchObject({ x: 0, y: 0, scaleX: 2, scaleY: 2 });
  });

  it('uses per-output transform when present', () => {
    const transform = getComfyOutputTransform({
      node: makeComfyNode(),
      output: {
        width: 960,
        height: 540,
        transform: { x: 100, y: 50, scaleX: 1.5, scaleY: 1.5, fitMode: ImageFitMode.FIT },
        useOutputSizeAsScene: false,
      },
      sceneNode,
    });

    // The function auto-fits via createAutoFitTransform, which recomputes
    // scale/position from fitMode rather than preserving stored values.
    // A 960x540 image in a 1920x1080 scene with FIT mode → scale 2, centered.
    expect(transform).toMatchObject({ x: 0, y: 0, scaleX: 2, scaleY: 2 });
  });

  it('preserves per-output scale when fit mode is custom', () => {
    const transform = getComfyOutputTransform({
      node: makeComfyNode(),
      output: {
        width: 960,
        height: 540,
        transform: { x: 0, y: 0, scaleX: 1.5, scaleY: 1.25, fitMode: ImageFitMode.CUSTOM },
        useOutputSizeAsScene: false,
      },
      sceneNode,
    });

    expect(transform).toMatchObject({
      x: 0,
      y: 0,
      scaleX: 1.5,
      scaleY: 1.25,
      fitMode: ImageFitMode.CUSTOM,
    });
  });

  it('preserves explicit per-output offsets when fit mode is custom', () => {
    const transform = getComfyOutputTransform({
      node: makeComfyNode(),
      output: {
        width: 960,
        height: 540,
        transform: { x: 18, y: -12, scaleX: 1.5, scaleY: 1.25, fitMode: ImageFitMode.CUSTOM },
      },
      sceneNode,
    });

    expect(transform).toMatchObject({ x: 18, y: -12, scaleX: 1.5, scaleY: 1.25 });
  });

  it('ignores stale per-output scale and offsets when fit mode is none', () => {
    const transform = getComfyOutputTransform({
      node: makeComfyNode(),
      output: {
        width: 960,
        height: 540,
        transform: { x: 18, y: -12, scaleX: 1.5, scaleY: 1.25, fitMode: ImageFitMode.NONE },
      },
      sceneNode,
    });

    expect(transform).toEqual({
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      fitMode: ImageFitMode.NONE,
    });
  });

  it('ignores custom per-output transforms when matching the scene to the output', () => {
    const transform = getComfyOutputTransform({
      node: makeComfyNode(),
      output: {
        width: 960,
        height: 540,
        transform: {
          x: 180,
          y: -120,
          scaleX: 1.5,
          scaleY: 1.25,
          fitMode: ImageFitMode.CUSTOM,
        },
        useOutputSizeAsScene: true,
      },
      sceneNode,
    });

    expect(transform).toMatchObject({ x: 0, y: 0, scaleX: 1, scaleY: 1 });
  });

  describe('region position offset', () => {
    const regionNode = (
      regionId: string,
      rect: { x: number; y: number; width: number; height: number },
    ): ComfyNode => ({
      ...makeComfyNode(),
      viewportPromptRegions: [{ id: regionId, rect, prompt: 'test', bindings: [] }],
    });

    it('offsets transform position by region position when output has regionId (Keep Scene)', () => {
      const node = regionNode('r1', { x: 200, y: 100, width: 300, height: 200 });
      const output = {
        width: 600,
        height: 400,
        regionId: 'r1',
        useOutputSizeAsScene: false,
      };
      const result = getComfyOutputTransform({ node, output, sceneNode });

      // 600x400 image fitted into 300x200 region -> FIT scale 0.5.
      // Region rects are top-left scene pixels; media transforms use scene-centered offsets.
      expect(result.x).toBe(-610);
      expect(result.y).toBe(340);
      expect(result.scaleX).toBe(0.5);
      expect(result.scaleY).toBe(0.5);
    });

    it('does NOT offset position when useOutputSizeAsScene is true (Match Output)', () => {
      const node = regionNode('r1', { x: 200, y: 100, width: 300, height: 200 });
      const output = {
        width: 600,
        height: 400,
        regionId: 'r1',
        useOutputSizeAsScene: true,
      };
      const result = getComfyOutputTransform({ node, output, sceneNode });

      // Match Output → use output pixel dimensions (600x400) → scale 1 at origin
      expect(result).toMatchObject({ x: 0, y: 0, scaleX: 1, scaleY: 1 });
    });

    it('offsets position by region position for non-zero region origin', () => {
      const node = regionNode('r1', { x: 500, y: 300, width: 1920, height: 1080 });
      const output = {
        width: 960,
        height: 540,
        regionId: 'r1',
        useOutputSizeAsScene: false,
      };
      const result = getComfyOutputTransform({ node, output, sceneNode });

      // Region same size as scene (1920x1080) at offset (500,300).
      // X remains right-positive; Y is up-positive in the renderer.
      expect(result.x).toBe(500);
      expect(result.y).toBe(-300);
      expect(result.scaleX).toBe(2);
      expect(result.scaleY).toBe(2);
    });

    it('does NOT offset when output has no regionId', () => {
      const node = regionNode('r1', { x: 200, y: 100, width: 300, height: 200 });
      const output = {
        width: 960,
        height: 540,
      };
      const result = getComfyOutputTransform({ node, output, sceneNode });

      // No regionId → full scene, no offset
      expect(result).toMatchObject({ x: 0, y: 0, scaleX: 2, scaleY: 2 });
    });

    it('does NOT offset when regionId does not match any existing region', () => {
      const node = regionNode('r1', { x: 200, y: 100, width: 300, height: 200 });
      const output = {
        width: 960,
        height: 540,
        regionId: 'nonexistent_region',
      };
      const result = getComfyOutputTransform({ node, output, sceneNode });

      // regionId doesn't match → fall back to scene, no offset
      expect(result).toMatchObject({ x: 0, y: 0, scaleX: 2, scaleY: 2 });
    });

    it('offsets position for STRETCH fit mode in a region', () => {
      const node = regionNode('r1', { x: 100, y: 50, width: 400, height: 200 });
      const output = {
        width: 800,
        height: 600,
        regionId: 'r1',
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.STRETCH },
      };
      const result = getComfyOutputTransform({ node, output, sceneNode });

      // STRETCH scales the image to the region and places it at the region center.
      expect(result.x).toBe(-660);
      expect(result.y).toBe(390);
    });

    it('uses stored region rect when the live region is unavailable', () => {
      const node = regionNode('r1', { x: 200, y: 100, width: 300, height: 200 });
      const output = {
        width: 600,
        height: 400,
        regionId: 'missing_region',
        regionRect: { x: 400, y: 300, width: 600, height: 400 },
        useOutputSizeAsScene: false,
      };
      const result = getComfyOutputTransform({ node, output, sceneNode });

      expect(result.x).toBe(-260);
      expect(result.y).toBe(40);
      expect(result.scaleX).toBe(1);
      expect(result.scaleY).toBe(1);
    });

    it('adds explicit custom offsets relative to the output region', () => {
      const node = regionNode('r1', { x: 200, y: 100, width: 300, height: 200 });
      const output = {
        width: 600,
        height: 400,
        regionId: 'r1',
        transform: {
          x: 8,
          y: -6,
          scaleX: 0.5,
          scaleY: 0.5,
          fitMode: ImageFitMode.CUSTOM,
        },
      };
      const result = getComfyOutputTransform({ node, output, sceneNode });

      expect(result.x).toBe(-602);
      expect(result.y).toBe(334);
      expect(result.scaleX).toBe(0.5);
      expect(result.scaleY).toBe(0.5);
    });
  });
});
