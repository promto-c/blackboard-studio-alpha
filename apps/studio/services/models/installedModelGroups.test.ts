import { describe, expect, it } from 'vitest';
import type { InstalledOnnxModel } from '@blackboard/types';
import { groupInstalledOnnxModels } from './installedModelGroups';

const model = (
  id: string,
  repoName: string,
  label: string,
  installedAt: number,
  catalogRef?: InstalledOnnxModel['catalogRef'],
): InstalledOnnxModel => ({
  id,
  name: repoName.split('/').at(-1) ?? repoName,
  repoName,
  variant: {
    id: `${repoName}:${label}`,
    repoName,
    filePath: `${label}.onnx`,
    label,
    supportedBackends: ['webgpu'],
  },
  cacheKey: `${id}:cache`,
  installedAt,
  catalogRef,
});

describe('installed ONNX model groups', () => {
  it('groups imported variants by repository', () => {
    const groups = groupInstalledOnnxModels([
      model('q4', 'owner/depth-model', 'Q4 ONNX', 2),
      model('q4f16', 'owner/depth-model', 'Q4F16 ONNX', 3),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: 'repo:owner/depth-model',
      repoName: 'owner/depth-model',
      latestInstalledAt: 3,
    });
    expect(groups[0].models.map((entry) => entry.variant.label)).toEqual(['Q4 ONNX', 'Q4F16 ONNX']);
  });

  it('keeps distinct catalog targets separate while grouping their variants', () => {
    const reference = {
      modelId: 'builtin/sam',
      modelName: 'SAM',
      origin: 'builtin' as const,
      runtime: 'onnxruntime' as const,
      targetId: 'encoder',
      targetLabel: 'Vision Encoder',
    };
    const groups = groupInstalledOnnxModels([
      model('encoder-q4', 'owner/sam', 'Q4', 1, reference),
      model('encoder-q8', 'owner/sam', 'Q8', 2, reference),
      model('decoder', 'owner/sam', 'Decoder', 3, {
        ...reference,
        targetId: 'decoder',
        targetLabel: 'Prompt Decoder',
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => [group.targetLabel, group.models.length])).toEqual([
      ['Prompt Decoder', 1],
      ['Vision Encoder', 2],
    ]);
  });
});
