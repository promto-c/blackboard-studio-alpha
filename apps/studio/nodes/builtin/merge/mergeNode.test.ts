import { describe, expect, it } from 'vitest';
import { AlphaMergeOperation, NodeType, type MaskedMergeNode } from '@blackboard/types';
import { resolveRendererNodeInputDomain } from '@blackboard/renderer';
import { nodeRegistry } from '@/nodes/registry';
import { isStackableNode } from '@/utils/nodePredicates';

describe('merge node definitions', () => {
  it('registers Masked Merge with one RGBA and one alpha input', () => {
    const definition = nodeRegistry.get(NodeType.MASKED_MERGE)!;
    const node = {
      id: 'masked-merge',
      type: NodeType.MASKED_MERGE,
      name: 'Masked Merge',
      enabled: true,
      ...definition.getInitialNodeProps(),
    } as MaskedMergeNode;

    expect(definition).toMatchObject({
      name: 'Masked Merge',
      renderMode: 'mask',
      processingDomain: 'scene_linear',
    });
    expect(definition.inputPorts).toEqual([
      expect.objectContaining({ name: 'pipe', label: 'RGBA' }),
      expect.objectContaining({
        name: 'mask',
        label: 'Alpha / Mask',
        dataSemantic: 'mask',
        channel: 'a',
        required: false,
      }),
    ]);
    expect(definition.outputPorts).toBeUndefined();
    expect(definition.getInitialNodeProps()).toEqual({
      mix: 100,
      alphaOperation: AlphaMergeOperation.REPLACE,
    });
    expect(resolveRendererNodeInputDomain(definition, node, 'mask')).toBe('alpha');
    expect(isStackableNode(node)).toBe(false);
  });
});
