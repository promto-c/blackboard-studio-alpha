import { describe, expect, it } from 'vitest';
import { NodeType, type AnyNode, type BokehBlurNode } from '@blackboard/types';
import type { RenderContext } from '@blackboard/renderer';
import { nodeRegistry } from '@/nodes/registry';

const bokehNode = nodeRegistry.get(NodeType.BOKEH_BLUR)!;

const renderContext = (mode: 'full' | 'preview', sampleLimit: number): RenderContext => ({
  frame: 0,
  fps: 24,
  scene: { width: 1920, height: 1080 },
  nodes: [],
  quality: { mode, resolutionScale: mode === 'preview' ? 0.5 : 1, sampleLimit },
  transformColorPickingToSceneLinear: (color) => [color[0], color[1], color[2]],
});

const createNode = (): AnyNode =>
  ({
    id: 'bokeh',
    type: NodeType.BOKEH_BLUR,
    name: 'Bokeh Blur',
    enabled: true,
    ...bokehNode.getInitialNodeProps(),
  }) as AnyNode;

describe('Bokeh preview performance', () => {
  it('caps preview samples without changing the stored full-quality setting', () => {
    const node = createNode();
    expect(bokehNode.getUniforms?.(node, renderContext('full', 12)).u_samples.value).toBe(32);
    expect(bokehNode.getUniforms?.(node, renderContext('preview', 12)).u_samples.value).toBe(12);
    expect((node as BokehBlurNode).uniforms.u_samples.value).toBe(32);
  });
});
