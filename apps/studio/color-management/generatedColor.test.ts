import { describe, expect, it, vi } from 'vitest';
import { convertColorPickingToSceneLinear } from './generatedColor';

const roles = {
  colorPickingColorSpace: 'Color Picking',
  workingColorSpace: 'Scene Linear',
  context: { SHOT: 'A010' },
};

describe('convertColorPickingToSceneLinear', () => {
  it('uses the shared CPU transform without clamping scene-linear RGB', () => {
    const transformRgb = vi.fn(() => [-0.25, 1.5, 0.5] as [number, number, number]);

    expect(convertColorPickingToSceneLinear([0.1, 0.2, 0.3], roles, { transformRgb })).toEqual([
      -0.25, 1.5, 0.5,
    ]);
    expect(transformRgb).toHaveBeenCalledWith(
      'Color Picking',
      'Scene Linear',
      [0.1, 0.2, 0.3],
      roles.context,
    );
  });

  it('preserves alpha outside the RGB transform', () => {
    const transformRgb = vi.fn(() => [0.4, 0.5, 0.6] as [number, number, number]);

    expect(
      convertColorPickingToSceneLinear([0.1, 0.2, 0.3, 0.35], roles, { transformRgb }),
    ).toEqual([0.4, 0.5, 0.6, 0.35]);
  });
});
