import { describe, expect, it } from 'vitest';
import { detectSequenceFrameRange } from './sequenceFrameRange';

describe('sequence frame range detection', () => {
  it('uses a contiguous trailing filename token as the absolute plate range', () => {
    expect(
      detectSequenceFrameRange(['shot_comp.1001.exr', 'shot_comp.1002.exr', 'shot_comp.1003.exr']),
    ).toEqual({ startFrame: 1001, endFrame: 1003, frameCount: 3 });
  });

  it('preserves zero-padded frame numbers', () => {
    expect(detectSequenceFrameRange(['plate_0008.png', 'plate_0009.png'])).toEqual({
      startFrame: 8,
      endFrame: 9,
      frameCount: 2,
    });
  });

  it('rejects a non-contiguous filename series', () => {
    expect(detectSequenceFrameRange(['plate.1001.exr', 'plate.1003.exr'])).toBeNull();
  });
});
