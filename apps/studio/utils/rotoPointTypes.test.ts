import { describe, expect, it } from 'vitest';
import type { RotoPointType } from '@blackboard/types';
import {
  getRotoPointType,
  getRotoPointTypeForSelection,
  insertRotoPointType,
  removeRotoPointTypes,
  setRotoPointTypes,
} from './rotoPointTypes';

describe('rotoPointTypes', () => {
  it('applies a point mode without touching point weights', () => {
    const path = {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
      pointTypes: undefined,
    };

    expect(setRotoPointTypes(path, [1], 'corner')).toEqual(['bspline', 'corner', 'bspline']);
    expect(getRotoPointType(['bspline', 'corner', 'bspline'], 3, 1)).toBe('corner');
  });

  it('reports mixed selections when selected points use different modes', () => {
    const path = {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
      pointTypes: ['cardinal', 'bspline', 'corner'] as RotoPointType[],
    };

    expect(getRotoPointTypeForSelection(path, [0])).toBe('cardinal');
    expect(getRotoPointTypeForSelection(path, [0, 1])).toBeNull();
  });

  it('keeps point modes aligned when points are removed or inserted', () => {
    expect(removeRotoPointTypes(['bspline', 'corner', 'bspline'], 3, [1])).toBeUndefined();
    expect(insertRotoPointType(['corner', 'corner'], 2, 1, 0, 1)).toEqual([
      'corner',
      'corner',
      'corner',
    ]);
    expect(insertRotoPointType(['cardinal', 'corner'], 2, 1, 0, 1)).toEqual([
      'cardinal',
      'bspline',
      'corner',
    ]);
  });
});
