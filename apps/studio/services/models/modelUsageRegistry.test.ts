import { afterEach, describe, expect, it } from 'vitest';
import { registerPlugin, unregisterPlugin } from '@blackboard/plugin-sdk';
import { NodeType, type AnyNode, type OnnxModelNode } from '@blackboard/types';
import { SAM3_TRACKER_MODEL_ID } from './builtinModelRegistry';
import { getDeclaredModelRequirements, getModelConsumers } from './modelUsageRegistry';

afterEach(() => unregisterPlugin('test.models'));

describe('model usage registry', () => {
  it('resolves declared node capabilities and active project usage', () => {
    const roto = {
      id: 'roto-1',
      name: 'Hero Roto',
      type: NodeType.ROTO,
    } as AnyNode;
    const consumers = getModelConsumers([SAM3_TRACKER_MODEL_ID], [roto]);

    expect(consumers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'node-type', label: 'Roto', active: false }),
        expect.objectContaining({ kind: 'project-node', label: 'Hero Roto', active: true }),
      ]),
    );
  });

  it('resolves catalog-backed ONNX nodes to the parent bundle', () => {
    const onnxNode = {
      id: 'onnx-1',
      name: 'SAM Encoder',
      type: NodeType.ONNX_MODEL,
      modelId: 'generic:onnx-community/sam3-tracker-ONNX:vision.onnx',
      modelName: 'SAM3 Tracker',
      catalogRef: {
        modelId: SAM3_TRACKER_MODEL_ID,
        modelName: 'SAM3 Tracker',
        origin: 'builtin',
        runtime: 'onnxruntime',
        targetLabel: 'Vision Encoder',
      },
    } as OnnxModelNode;

    expect(getModelConsumers([SAM3_TRACKER_MODEL_ID], [onnxNode])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'project-node', label: 'SAM Encoder', active: true }),
      ]),
    );
  });

  it('surfaces plugin-wide external requirements', () => {
    registerPlugin({
      id: 'test.models',
      name: 'Test Model Plugin',
      version: '1.0.0',
      nodeExtensions: [],
      modelRequirements: [
        {
          modelId: 'example/external-model',
          modelName: 'External Model',
          purpose: 'Plugin inference',
          runtime: 'onnxruntime',
          repoName: 'example/external-model',
        },
      ],
    });

    expect(getDeclaredModelRequirements()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requirement: expect.objectContaining({ modelId: 'example/external-model' }),
          consumers: expect.arrayContaining([
            expect.objectContaining({ kind: 'plugin', label: 'Test Model Plugin' }),
          ]),
        }),
      ]),
    );
  });
});
