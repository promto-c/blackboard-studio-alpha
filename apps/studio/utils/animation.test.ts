import { describe, it, expect } from 'vitest';
import {
  getLinearValueAtFrame,
  getValueAtFrame,
  getSortedKeyframes,
  hasKeyframeAt,
} from '@blackboard/renderer';

describe('getValueAtFrame', () => {
  it('returns the number directly for a scalar value', () => {
    expect(getValueAtFrame(42, 0)).toBe(42);
    expect(getValueAtFrame(0, 100)).toBe(0);
    expect(getValueAtFrame(-5.5, 50)).toBe(-5.5);
  });

  it('returns 0 for an empty keyframe array', () => {
    expect(getValueAtFrame([], 10)).toBe(0);
  });

  it('returns the first keyframe value when frame is before all keyframes', () => {
    const keyframes = [
      { frame: 10, value: 100 },
      { frame: 20, value: 200 },
    ];
    expect(getValueAtFrame(keyframes, 0)).toBe(100);
    expect(getValueAtFrame(keyframes, 5)).toBe(100);
  });

  it('returns the last keyframe value when frame is after all keyframes', () => {
    const keyframes = [
      { frame: 10, value: 100 },
      { frame: 20, value: 200 },
    ];
    expect(getValueAtFrame(keyframes, 30)).toBe(200);
    expect(getValueAtFrame(keyframes, 100)).toBe(200);
  });

  it('returns exact value at a keyframe frame', () => {
    const keyframes = [
      { frame: 0, value: 0 },
      { frame: 10, value: 100 },
    ];
    expect(getValueAtFrame(keyframes, 0)).toBe(0);
    expect(getValueAtFrame(keyframes, 10)).toBe(100);
  });

  it('interpolates between keyframes for mid-frames', () => {
    const keyframes = [
      { frame: 0, value: 0 },
      { frame: 10, value: 100 },
    ];
    // With default tangents (linear-ish bezier), midpoint should be ~50
    const midValue = getValueAtFrame(keyframes, 5);
    expect(midValue).toBeGreaterThan(30);
    expect(midValue).toBeLessThan(70);
  });

  it('handles single keyframe array', () => {
    const keyframes = [{ frame: 5, value: 42 }];
    expect(getValueAtFrame(keyframes, 0)).toBe(42);
    expect(getValueAtFrame(keyframes, 5)).toBe(42);
    expect(getValueAtFrame(keyframes, 10)).toBe(42);
  });
});

describe('getLinearValueAtFrame', () => {
  it('linearly interpolates between keyframes', () => {
    const keyframes = [
      {
        frame: 0,
        value: 0,
        outTangent: { x: 3, y: 300 },
      },
      {
        frame: 10,
        value: 100,
        inTangent: { x: -3, y: -300 },
      },
    ];

    expect(getLinearValueAtFrame(keyframes, 5)).toBe(50);
  });

  it('clamps to edge keyframe values outside range', () => {
    const keyframes = [
      { frame: 10, value: 100 },
      { frame: 20, value: 200 },
    ];

    expect(getLinearValueAtFrame(keyframes, 0)).toBe(100);
    expect(getLinearValueAtFrame(keyframes, 30)).toBe(200);
  });
});

describe('getSortedKeyframes', () => {
  it('returns empty array for a scalar', () => {
    expect(getSortedKeyframes(42)).toEqual([]);
  });

  it('returns empty array for empty array', () => {
    expect(getSortedKeyframes([])).toEqual([]);
  });

  it('returns sorted keyframes', () => {
    const unsorted = [
      { frame: 20, value: 200 },
      { frame: 5, value: 50 },
      { frame: 10, value: 100 },
    ];
    const sorted = getSortedKeyframes(unsorted);
    expect(sorted.map((k) => k.frame)).toEqual([5, 10, 20]);
  });

  it('does not mutate the original array', () => {
    const original = [
      { frame: 20, value: 200 },
      { frame: 5, value: 50 },
    ];
    getSortedKeyframes(original);
    expect(original[0].frame).toBe(20);
  });
});

describe('hasKeyframeAt', () => {
  it('returns false for scalar values', () => {
    expect(hasKeyframeAt(42, 0)).toBe(false);
  });

  it('returns true when keyframe exists at frame', () => {
    const keyframes = [
      { frame: 0, value: 0 },
      { frame: 10, value: 100 },
    ];
    expect(hasKeyframeAt(keyframes, 10)).toBe(true);
  });

  it('returns false when no keyframe at frame', () => {
    const keyframes = [
      { frame: 0, value: 0 },
      { frame: 10, value: 100 },
    ];
    expect(hasKeyframeAt(keyframes, 5)).toBe(false);
  });
});
