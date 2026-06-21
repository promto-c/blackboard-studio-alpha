import { describe, expect, it } from 'vitest';
import type { GeneratedOutput } from '@blackboard/types';
import {
  getComfyGeneratedOutputsForActivation,
  getComfyMediaOutput,
  getComfyOutputActivationUpdates,
} from './comfyOutputActivation';

const imageOutput: GeneratedOutput = {
  id: 'image',
  src: 'asset:image',
  mediaKind: 'image',
  width: 1024,
  height: 1024,
  createdAt: 1,
  visible: true,
};

const modelOutput: GeneratedOutput = {
  id: 'model',
  src: 'asset:model',
  mediaKind: 'model_3d',
  scene3dAsset: {
    assetId: 'asset:model',
    fileName: 'result.spz',
    kind: 'splat',
    format: 'spz',
  },
  width: 0,
  height: 0,
  createdAt: 2,
};

describe('Comfy 3D output activation', () => {
  it('prefers visual media for mixed Comfy output runs', () => {
    expect(getComfyMediaOutput([modelOutput, imageOutput])).toBe(imageOutput);
  });

  it('does not replace 2D source properties with a model asset', () => {
    expect(getComfyOutputActivationUpdates(modelOutput)).toEqual({
      activeGeneratedOutputId: 'model',
      lastPromptId: undefined,
      lastRunAt: 2,
    });
  });

  it('keeps the current visual output visible when a model is opened', () => {
    expect(
      getComfyGeneratedOutputsForActivation({
        node: { generatedOutputs: [imageOutput, modelOutput] },
        activatedOutput: modelOutput,
      }),
    ).toEqual([imageOutput, modelOutput]);
  });
});
