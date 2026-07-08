import { describe, expect, it } from 'vitest';
import type { AnyNode, ColorProcessingDomain } from '@blackboard/types';
import { resolveRendererNodeProcessingDomain } from '@blackboard/renderer';
import { nodeRegistry } from './registry';

const DOMAINS = new Set<ColorProcessingDomain>([
  'scene_linear',
  'display_referred',
  'log',
  'data',
  'alpha',
  'vector',
  'depth',
]);

describe('node processing-domain declarations', () => {
  it('declares a supported domain for every registered node', () => {
    nodeRegistry.forEach((definition) => {
      const node = {
        id: `test-${definition.type}`,
        type: definition.type,
        name: definition.name,
        enabled: true,
        ...definition.getInitialNodeProps?.(),
      } as AnyNode;
      expect(
        DOMAINS.has(resolveRendererNodeProcessingDomain(definition, node)),
        definition.type,
      ).toBe(true);
    });
  });
});
