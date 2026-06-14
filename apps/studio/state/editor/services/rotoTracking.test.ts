import { describe, expect, it } from 'vitest';
import type { RotoPath } from '@blackboard/types';
import { applyTemporalTrackingGuard } from '@/utils/temporalTracking';
import { buildInternalTrackingPoints } from './rotoTracking';

describe('rotoTracking internal sampling', () => {
  it('adds interior tracking samples for small closed shapes', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 8 },
      { x: 0, y: 8 },
    ];

    const samples = buildInternalTrackingPoints([
      {
        path: { closed: true } as RotoPath,
        points,
      },
    ]);

    expect(samples.length).toBeGreaterThan(0);
    expect(samples.some((point) => point.x > 0 && point.x < 8 && point.y > 0 && point.y < 8)).toBe(
      true,
    );
  });
});

describe('rotoTracking temporal guard', () => {
  const jitterFrames = [
    { frame: 1, points: [{ x: 1, y: 0 }], drift: 1 },
    { frame: 2, points: [{ x: 2, y: 0 }], drift: 1 },
    { frame: 3, points: [{ x: 100, y: 0 }], drift: 40 },
    { frame: 4, points: [{ x: 4, y: 0 }], drift: 1 },
    { frame: 5, points: [{ x: 5, y: 0 }], drift: 1 },
  ];

  it('leaves frames unchanged when temporal guard is off', () => {
    const guarded = applyTemporalTrackingGuard(jitterFrames, { mode: 'off' });

    expect(guarded[2].points[0].x).toBe(100);
    expect(guarded.some((frame) => frame.anomaly)).toBe(false);
  });

  it('marks and repairs isolated jitter frames', () => {
    const guarded = applyTemporalTrackingGuard(jitterFrames, {
      mode: 'strong',
      smoothingWindow: 5,
      anomalyThreshold: 8,
      repair: 'blend',
    });

    expect(guarded[2].anomaly).toBe(true);
    expect(guarded[2].confidence).toBeLessThan(0.2);
    expect(guarded[2].points[0].x).toBeLessThan(20);
    expect(guarded[2].points[0].x).toBeGreaterThan(2);
  });
});
