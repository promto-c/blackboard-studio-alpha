import { describe, expect, it } from 'vitest';
import { NodeKind, NodeType, validateRootFlow, type AnyNode } from '@blackboard/types';
import { buildFlowFromNodes } from '@/state/editor/flowModel';
import { wouldCreateCycle } from './connectionGraph';

const scene = (id = 'scene'): AnyNode =>
  ({
    id,
    kind: NodeKind.SCENE,
    type: NodeType.SCENE,
    name: 'Scene',
    enabled: true,
    width: 1920,
    height: 1080,
    bitDepth: 8,
    colorSpace: 'sRGB',
    maxFrames: 1,
    fps: 24,
  }) as AnyNode;

const image = (id: string, inputs?: Record<string, string>): AnyNode =>
  ({
    id,
    kind: NodeKind.EFFECT,
    type: NodeType.MEDIA_SOURCE,
    name: id,
    enabled: true,
    mediaKind: 'image',
    src: '',
    width: 1,
    height: 1,
    opacity: 100,
    inputs,
  }) as AnyNode;

describe('wouldCreateCycle', () => {
  it('rejects input links that close a real graph cycle', () => {
    const nodes = [scene(), image('target'), image('source', { mask: 'target' })];

    expect(wouldCreateCycle(nodes, 'target', 'source', 'comfy-input:workflow:12:image')).toBe(true);
  });

  it('allows lower merge sources to feed inputs on earlier source nodes', () => {
    const nodes = [scene(), image('target'), image('source')];

    expect(wouldCreateCycle(nodes, 'target', 'source', 'comfy-input:workflow:12:image')).toBe(
      false,
    );
  });
});

describe('buildFlowFromNodes', () => {
  it('models explicit node inputs as graph edges and reports cycles directly', () => {
    const flow = buildFlowFromNodes([
      scene(),
      image('target', { 'comfy-input:workflow:12:image': 'source' }),
      image('source', { mask: 'target' }),
    ]);

    expect(validateRootFlow(flow).some((issue) => issue.code === 'connection_cycle')).toBe(true);
    expect(
      flow.edges.some(
        (edge) =>
          edge.targetNodeId === 'target' &&
          edge.targetPort === 'comfy-input:workflow:12:image' &&
          edge.sourceNodeId === 'source',
      ),
    ).toBe(true);
  });

  it('keeps explicit inputs from lower source nodes acyclic', () => {
    const flow = buildFlowFromNodes([
      scene(),
      image('target', { 'comfy-input:workflow:12:image': 'source' }),
      image('source'),
    ]);

    expect(validateRootFlow(flow)).toEqual([]);
    expect(
      flow.edges.some(
        (edge) =>
          edge.sourceNodeId === 'source' &&
          edge.targetNodeId === 'target' &&
          edge.targetPort === 'comfy-input:workflow:12:image',
      ),
    ).toBe(true);
  });
});
