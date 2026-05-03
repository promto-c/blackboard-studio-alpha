import { describe, expect, it } from 'vitest';
import { resolvePaintBrushChannels } from './channels';

describe('resolvePaintBrushChannels', () => {
  it('keeps explicit paint channel targets unchanged', () => {
    expect(resolvePaintBrushChannels('rgb', 'A')).toBe('rgb');
    expect(resolvePaintBrushChannels('a', 'RGB')).toBe('a');
  });

  it('maps the viewer channel selection when using view mode', () => {
    expect(resolvePaintBrushChannels('view', 'RGB')).toBe('rgb');
    expect(resolvePaintBrushChannels('view', 'R')).toBe('r');
    expect(resolvePaintBrushChannels('view', 'G')).toBe('g');
    expect(resolvePaintBrushChannels('view', 'B')).toBe('b');
    expect(resolvePaintBrushChannels('view', 'A')).toBe('a');
  });
});
