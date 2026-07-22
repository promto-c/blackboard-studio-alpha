import { describe, expect, it } from 'vitest';
import { inferOutputKind } from './onnxShape';

describe('ONNX output shape classification', () => {
  it('keeps renderable channel layouts as images', () => {
    expect(inferOutputKind([1, 3, 512, 512])).toBe('image');
    expect(inferOutputKind([1, 1, 256, 256])).toBe('image');
    expect(inferOutputKind([1, 256, 256])).toBe('image');
  });

  it('classifies feature maps and higher-rank data as tensors', () => {
    expect(inferOutputKind([1, 256, 64, 64])).toBe('tensor');
    expect(inferOutputKind([1, 3, 8, 8, 8])).toBe('tensor');
  });

  it('keeps rank-one and rank-two outputs scalar-compatible', () => {
    expect(inferOutputKind([1])).toBe('scalar');
    expect(inferOutputKind([1, 4])).toBe('scalar');
  });
});
