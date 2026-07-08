import { describe, expect, it } from 'vitest';
import { getScenePreviewColorSpace, isSceneLinearColorSpace } from './constants';

describe('color-management constants', () => {
  it('resolves scene-preview output against the active working space', () => {
    expect(isSceneLinearColorSpace('ACEScg', 'ACEScg')).toBe(true);
    expect(isSceneLinearColorSpace('ACES2065-1', 'ACEScg')).toBe(false);
    expect(getScenePreviewColorSpace('ACEScg', 'ACEScg')).toBe('srgb');
    expect(getScenePreviewColorSpace('ACES2065-1', 'ACEScg')).toBe('raw_texture');
    expect(getScenePreviewColorSpace('ACES2065-1', 'ACES2065-1')).toBe('srgb');
  });
});
