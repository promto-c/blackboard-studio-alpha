import { describe, expect, it } from 'vitest';
import {
  getCanvasStorageColorTypeForBitDepth,
  resolveCanvasStorageColorType,
} from './canvasColorType';

describe('getCanvasStorageColorTypeForBitDepth', () => {
  it('keeps 8-bit scenes on unorm8 canvas storage', () => {
    expect(getCanvasStorageColorTypeForBitDepth(8)).toBe('unorm8');
  });

  it('requests float16 canvas storage for high-bit-depth scenes', () => {
    expect(getCanvasStorageColorTypeForBitDepth(16)).toBe('float16');
    expect(getCanvasStorageColorTypeForBitDepth(32)).toBe('float16');
  });
});

describe('resolveCanvasStorageColorType', () => {
  it('detects float16 contexts', () => {
    expect(resolveCanvasStorageColorType({ colorType: 'float16' })).toBe('float16');
  });

  it('falls back to unorm8 for missing or unknown attributes', () => {
    expect(resolveCanvasStorageColorType()).toBe('unorm8');
    expect(resolveCanvasStorageColorType({ colorType: 'unorm8' })).toBe('unorm8');
    expect(resolveCanvasStorageColorType({ colorType: 'unknown' })).toBe('unorm8');
  });
});
