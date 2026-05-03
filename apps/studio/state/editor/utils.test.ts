import { describe, expect, it } from 'vitest';
import { toAnimatableValue, toFrameAnchoredPoint } from './utils';

describe('editor utils keyframe anchoring', () => {
  it('keeps frame-0 points keyed', () => {
    const anchored = toFrameAnchoredPoint({ x: 12, y: -3 }, 0);
    expect(anchored).toEqual({
      x: [{ frame: 0, value: 12 }],
      y: [{ frame: 0, value: -3 }],
    });
  });

  it('does not collapse a single frame-0 keyframe into a static number', () => {
    const result = toAnimatableValue([{ frame: 0, value: 42 }]);
    expect(result).toEqual([{ frame: 0, value: 42 }]);
  });

  it('returns static 0 for an empty keyframe list', () => {
    expect(toAnimatableValue([])).toBe(0);
  });
});
