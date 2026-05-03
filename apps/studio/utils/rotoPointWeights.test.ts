import { describe, expect, it } from 'vitest';
import type { RotoPointWeightMode } from '@blackboard/types';
import {
  getRotoPointWeightModeForSelection,
  insertRotoPointWeightMode,
  removeRotoPointWeightModes,
  setRotoPointWeightModes,
} from './rotoPointWeights';

describe('rotoPointWeights point pull modes', () => {
  it('resolves selection modes from the preference default when no explicit per-point mode exists', () => {
    const path = {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
      pointWeightModes: undefined,
    };

    expect(getRotoPointWeightModeForSelection(path, [1], 'global')).toBe('global');
    expect(getRotoPointWeightModeForSelection(path, [1], 'local')).toBe('local');
  });

  it('stores explicit per-point pull modes for selected points', () => {
    const path = {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
      pointWeightModes: undefined,
    };

    expect(setRotoPointWeightModes(path, [1], 'local')).toEqual([null, 'local', null]);
  });

  it('keeps explicit pull modes aligned when points are removed or inserted', () => {
    expect(
      removeRotoPointWeightModes(
        [null, 'local', null] as Array<RotoPointWeightMode | null>,
        3,
        [1],
      ),
    ).toBeUndefined();
    expect(
      insertRotoPointWeightMode(
        ['global', 'global'] as Array<RotoPointWeightMode | null>,
        2,
        1,
        0,
        1,
      ),
    ).toEqual(['global', 'global', 'global']);
  });
});
