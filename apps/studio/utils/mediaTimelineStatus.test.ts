import { describe, expect, it, vi } from 'vitest';
import {
  buildSourceDataAvailability,
  buildSourceDataTimelineStatus,
  buildTimelineFrameSegments,
} from './mediaTimelineStatus';

describe('buildSourceDataTimelineStatus', () => {
  it('only projects state across frames containing source data', () => {
    const getSourceFrameStatus = vi.fn(() => true);

    const status = buildSourceDataTimelineStatus(
      { startFrame: 1001, endFrame: 1003, frameCount: 3 },
      1000,
      1004,
      getSourceFrameStatus,
    );

    expect(status[1000]).toBe(false);
    expect(status.slice(1001, 1004)).toEqual([true, true, true]);
    expect(status[1004]).toBe(false);
    expect(getSourceFrameStatus.mock.calls).toEqual([[0], [1], [2]]);
  });

  it('clips source data to the visible scene range', () => {
    const getSourceFrameStatus = vi.fn((sourceFrame: number) => sourceFrame === 2);

    const status = buildSourceDataTimelineStatus(
      { startFrame: 1001, endFrame: 1005, frameCount: 5 },
      1003,
      1004,
      getSourceFrameStatus,
    );

    expect(status[1002]).toBe(false);
    expect(status[1003]).toBe(true);
    expect(status[1004]).toBe(false);
    expect(getSourceFrameStatus.mock.calls).toEqual([[2], [3]]);
  });

  it('builds availability and contiguous display segments from real source frames', () => {
    const availability = buildSourceDataAvailability(
      { startFrame: 1001, endFrame: 1003, frameCount: 3 },
      1000,
      1005,
    );

    expect(buildTimelineFrameSegments(1000, 1005, availability)).toEqual([
      { start: 1001, end: 1003 },
    ]);
  });

  it('keeps separate availability runs visually separate', () => {
    const availability = new Array(7).fill(false);
    availability[1] = true;
    availability[2] = true;
    availability[5] = true;

    expect(buildTimelineFrameSegments(0, 6, availability)).toEqual([
      { start: 1, end: 2 },
      { start: 5, end: 5 },
    ]);
  });
});
