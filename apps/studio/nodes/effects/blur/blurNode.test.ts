import { describe, expect, it } from 'vitest';
import { BlurMethod, NodeType, type BlurNode } from '@blackboard/types';
import type { RenderContext } from '@blackboard/renderer';
import { nodeRegistry } from '@/nodes/registry';

const blurNode = nodeRegistry.get(NodeType.BLUR)!;

const context = (mode: 'full' | 'preview', sampleLimit = 16): RenderContext => ({
  frame: 0,
  fps: 24,
  scene: { width: 3840, height: 2160 },
  nodes: [],
  quality: { mode, resolutionScale: mode === 'preview' ? 0.5 : 1, sampleLimit },
  transformColorPickingToSceneLinear: (color) => [color[0], color[1], color[2]],
});

const node = (method: BlurMethod, radius = 20): BlurNode => ({
  id: 'blur',
  type: NodeType.BLUR,
  name: 'Blur',
  enabled: true,
  blur: { radius, method },
});

describe('Blur preview performance', () => {
  it('keeps the node quality exact at full quality', () => {
    expect(blurNode.renderScale?.(node(BlurMethod.GAUSSIAN), context('full'))).toBe(1);
  });

  it('uses the shared sample budget to choose a cheaper proxy scale', () => {
    expect(blurNode.renderScale?.(node(BlurMethod.GAUSSIAN), context('preview', 12))).toBe(0.4);
    expect(blurNode.renderScale?.(node(BlurMethod.ITERATED_BOX), context('preview', 12))).toBe(0.2);
  });

  it('keeps a small blur on its cheaper two-pass full-resolution path', () => {
    expect(blurNode.renderScale?.(node(BlurMethod.GAUSSIAN, 5), context('preview', 16))).toBe(1);
  });
});
