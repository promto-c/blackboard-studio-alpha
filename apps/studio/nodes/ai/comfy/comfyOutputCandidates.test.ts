import { describe, expect, it } from 'vitest';
import type { ComfyWorkflowOutputCandidate } from '@blackboard/types';
import {
  getComfyOutputCandidateInputs,
  getComfyOutputCandidateNodeType,
  updateComfyOutputCandidateInputs,
} from './comfyOutputCandidates';

const candidate: ComfyWorkflowOutputCandidate = {
  id: '88:0',
  nodeId: '88',
  nodeType: 'ImageToSplat',
  kind: 'synthetic',
  outputIndex: 0,
  outputName: 'splat',
  outputType: 'SPLAT',
  label: 'ImageToSplat #88 splat',
  previewNodeId: 'save',
  syntheticOutputFormat: 'model_3d',
  syntheticOutputNodes: [
    {
      id: 'serialize',
      nodeType: 'SplatToFile3D',
      inputs: { splat: ['88', 0], format: 'spz' },
    },
    {
      id: 'save',
      nodeType: 'SaveGLB',
      inputs: { mesh: ['serialize', 0], filename_prefix: 'blackboard/3d/88_0' },
    },
  ],
};

describe('Comfy synthetic output candidates', () => {
  it('uses the terminal node for output display and settings', () => {
    expect(getComfyOutputCandidateNodeType(candidate)).toBe('SaveGLB');
    expect(getComfyOutputCandidateInputs(candidate)).toEqual({
      mesh: ['serialize', 0],
      filename_prefix: 'blackboard/3d/88_0',
    });
  });

  it('updates terminal settings without changing intermediate conversion nodes', () => {
    const updated = updateComfyOutputCandidateInputs(candidate, 'save', {
      mesh: ['serialize', 0],
      filename_prefix: 'custom/model',
    });

    expect(updated.syntheticOutputNodes?.[0]).toEqual(candidate.syntheticOutputNodes?.[0]);
    expect(updated.syntheticOutputNodes?.[1]?.inputs).toEqual({
      mesh: ['serialize', 0],
      filename_prefix: 'custom/model',
    });
  });

  it('updates an intermediate format stage without changing the save node', () => {
    const updated = updateComfyOutputCandidateInputs(candidate, 'serialize', {
      splat: ['88', 0],
      format: 'ply',
    });

    expect(updated.syntheticOutputNodes?.[0]?.inputs).toEqual({
      splat: ['88', 0],
      format: 'ply',
    });
    expect(updated.syntheticOutputNodes?.[1]).toEqual(candidate.syntheticOutputNodes?.[1]);
  });
});
