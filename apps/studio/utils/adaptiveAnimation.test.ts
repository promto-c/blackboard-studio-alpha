import { describe, expect, it } from 'vitest';
import {
  advanceAdaptiveAnimationClock,
  createAdaptiveAnimationClock,
  getTimeCorrectedSmoothing,
} from './adaptiveAnimation';

describe('adaptive animation scheduling', () => {
  it('updates every callback while frames are healthy', () => {
    let clock = createAdaptiveAnimationClock();

    const first = advanceAdaptiveAnimationClock(clock, 100);
    clock = first.clock;
    const second = advanceAdaptiveAnimationClock(clock, 116.7);

    expect(first.shouldUpdate).toBe(true);
    expect(second.shouldUpdate).toBe(true);
  });

  it('coalesces updates after a slow frame and preserves elapsed time', () => {
    let frame = advanceAdaptiveAnimationClock(createAdaptiveAnimationClock(), 100);
    frame = advanceAdaptiveAnimationClock(frame.clock, 130);
    expect(frame.shouldUpdate).toBe(true);

    frame = advanceAdaptiveAnimationClock(frame.clock, 146);
    expect(frame.shouldUpdate).toBe(false);

    frame = advanceAdaptiveAnimationClock(frame.clock, 162);
    expect(frame.shouldUpdate).toBe(true);
    expect(frame.elapsedMs).toBe(32);
  });

  it('uses elapsed time to catch interpolation up after missed frames', () => {
    expect(getTimeCorrectedSmoothing(0.2, 1000 / 60)).toBeCloseTo(0.2);
    expect(getTimeCorrectedSmoothing(0.2, 1000 / 30)).toBeCloseTo(0.36);
    expect(getTimeCorrectedSmoothing(0.2, 1000 / 120)).toBeCloseTo(0.1056, 3);
  });
});
