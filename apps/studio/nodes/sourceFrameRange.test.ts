import { describe, expect, it } from 'vitest';
import { BlendMode, ImageFitMode, NodeType, type ImageSequenceNode } from '@blackboard/types';
import { getSourceFrameRange, resolveTemporalSourceFrame } from './sourceFrameRange';

const makeSequence = (overrides: Partial<ImageSequenceNode> = {}): ImageSequenceNode => ({
  id: 'sequence',
  type: NodeType.IMAGE_SEQUENCE,
  name: 'Sequence',
  enabled: true,
  frames: ['a', 'b', 'c', 'd'],
  width: 1920,
  height: 1080,
  opacity: 100,
  operator: BlendMode.OVER,
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.FIT },
  colorSpace: 'sRGB - Texture',
  fps: 24,
  startFrame: 1002,
  beforeRangeBehavior: 'hold',
  afterRangeBehavior: 'hold',
  ...overrides,
});

describe('temporal source frame ranges', () => {
  it('reports the inclusive timeline range', () => {
    expect(getSourceFrameRange(makeSequence())).toEqual({
      startFrame: 1002,
      endFrame: 1005,
      frameCount: 4,
    });
  });

  it('maps timeline frames into source indices', () => {
    const node = makeSequence();
    expect(resolveTemporalSourceFrame(node, 1002)).toBe(0);
    expect(resolveTemporalSourceFrame(node, 1005)).toBe(3);
  });

  it('holds independently before and after the range', () => {
    const node = makeSequence();
    expect(resolveTemporalSourceFrame(node, 12)).toBe(0);
    expect(resolveTemporalSourceFrame(node, 2000)).toBe(3);
  });

  it('returns transparent black outside a black-extended side', () => {
    const node = makeSequence({ beforeRangeBehavior: 'black', afterRangeBehavior: 'black' });
    expect(resolveTemporalSourceFrame(node, 1001)).toBeNull();
    expect(resolveTemporalSourceFrame(node, 1006)).toBeNull();
  });

  it('loops and bounces using the full source range', () => {
    const node = makeSequence({ beforeRangeBehavior: 'loop', afterRangeBehavior: 'bounce' });
    expect(resolveTemporalSourceFrame(node, 1001)).toBe(3);
    expect(resolveTemporalSourceFrame(node, 1006)).toBe(2);
    expect(resolveTemporalSourceFrame(node, 1007)).toBe(1);
    expect(resolveTemporalSourceFrame(node, 1008)).toBe(0);
  });
});
