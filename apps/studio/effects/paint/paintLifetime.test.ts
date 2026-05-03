import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NEW_STROKE_LIFETIME,
  clampPaintFrame,
  getPaintLifetimeBadgeLabel,
  getPaintLifetimeLabel,
  getPaintLifetimePresetLabel,
  isPaintLifetimeActiveAtFrame,
  normalizePaintLifetime,
  normalizePaintLifetimePreset,
  resolvePaintLifetimePreset,
} from './paintLifetime';

describe('paint lifetime helpers', () => {
  it('uses current frame as the default preset for new strokes', () => {
    expect(DEFAULT_NEW_STROKE_LIFETIME).toEqual({ mode: 'current_frame' });
  });

  it('clamps frame values to non-negative integers', () => {
    expect(clampPaintFrame(12.8)).toBe(13);
    expect(clampPaintFrame(-4)).toBe(0);
    expect(clampPaintFrame(80, 24)).toBe(24);
  });

  it('normalizes inverted frame ranges', () => {
    expect(
      normalizePaintLifetime({
        mode: 'range',
        startFrame: 36,
        endFrame: 12,
      }),
    ).toEqual({
      mode: 'range',
      startFrame: 12,
      endFrame: 36,
    });
  });

  it('normalizes default presets safely', () => {
    expect(
      normalizePaintLifetimePreset({
        mode: 'range',
        startFrame: 24,
        endFrame: 8,
      }),
    ).toEqual({
      mode: 'range',
      startFrame: 8,
      endFrame: 24,
    });
  });

  it('resolves a current-frame preset to a concrete single-frame lifetime', () => {
    expect(resolvePaintLifetimePreset({ mode: 'current_frame' }, 18)).toEqual({
      mode: 'single',
      frame: 18,
    });
  });

  it('checks whether a frame is active inside each lifetime mode', () => {
    expect(isPaintLifetimeActiveAtFrame({ mode: 'all' }, 10)).toBe(true);
    expect(isPaintLifetimeActiveAtFrame({ mode: 'single', frame: 10 }, 10)).toBe(true);
    expect(isPaintLifetimeActiveAtFrame({ mode: 'single', frame: 10 }, 11)).toBe(false);
    expect(
      isPaintLifetimeActiveAtFrame(
        {
          mode: 'range',
          startFrame: 12,
          endFrame: 18,
        },
        15,
      ),
    ).toBe(true);
    expect(
      isPaintLifetimeActiveAtFrame(
        {
          mode: 'range',
          startFrame: 12,
          endFrame: 18,
        },
        19,
      ),
    ).toBe(false);
  });

  it('formats user-facing lifetime labels', () => {
    expect(getPaintLifetimeLabel({ mode: 'all' })).toBe('All Frames');
    expect(getPaintLifetimeLabel({ mode: 'single', frame: 24 })).toBe('Frame 24');
    expect(
      getPaintLifetimeLabel({
        mode: 'range',
        startFrame: 12,
        endFrame: 36,
      }),
    ).toBe('Frames 12-36');
    expect(getPaintLifetimeBadgeLabel({ mode: 'all' })).toBeNull();
    expect(getPaintLifetimeBadgeLabel({ mode: 'single', frame: 24 })).toBe('F24');
    expect(
      getPaintLifetimeBadgeLabel({
        mode: 'range',
        startFrame: 12,
        endFrame: 36,
      }),
    ).toBe('12-36');
    expect(getPaintLifetimePresetLabel({ mode: 'current_frame' })).toBe('Current Frame');
  });
});
