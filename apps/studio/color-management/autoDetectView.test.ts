import { describe, expect, it } from 'vitest';
import { getAutoDetectedViewForColorSpace } from './autoDetectView';

const defaultDisplay = 'sRGB - Display';
const getViews = () => [
  {
    name: 'ACES 2.0 - SDR 100 nits (Rec.709)',
    colorSpace: 'ACEScg',
    transform: 'display',
    looks: '',
  },
  {
    name: 'Video (colorimetric)',
    colorSpace: 'ACEScg',
    transform: 'display',
    looks: '',
  },
];

describe('auto-detected viewport view', () => {
  it.each([
    'sRGB - Display',
    'sRGB Encoded Rec.709 (sRGB)',
    'Linear Rec.709 (sRGB)',
    'sRGB',
    'Rec.709',
  ])('uses Video (colorimetric) for SDR source color space %s', (sourceColorSpace) => {
    expect(getAutoDetectedViewForColorSpace(sourceColorSpace, defaultDisplay, getViews)).toEqual({
      display: defaultDisplay,
      view: 'Video (colorimetric)',
    });
  });

  it('does not apply the integer-image view rule to scene-linear sources', () => {
    expect(getAutoDetectedViewForColorSpace('ACEScg', defaultDisplay, getViews)).toBeNull();
  });
});
