import { describe, expect, it } from 'vitest';
import type { ColorSpaceInfo } from './types';
import {
  assertSceneLinearWorkingSpaceCandidate,
  getSceneLinearWorkingSpaceCandidates,
  isSceneLinearWorkingSpaceCandidate,
} from './workingSpace';

const colorSpaces: ColorSpaceInfo[] = [
  {
    name: 'ACEScg',
    canonicalName: 'ACEScg',
    aliases: [],
    categories: [],
    family: 'ACES',
    encoding: 'scene-linear',
    description: 'ACEScg scene linear',
    isData: false,
  },
  {
    name: 'ACES2065-1',
    canonicalName: 'ACES2065-1',
    aliases: [],
    categories: [],
    family: 'ACES',
    encoding: 'scene-linear',
    description: 'ACES scene-linear interchange',
    isData: false,
  },
  {
    name: 'Raw',
    canonicalName: 'Raw',
    aliases: [],
    categories: [],
    family: 'Data',
    encoding: '',
    description: 'Data space',
    isData: true,
  },
  {
    name: 'ACEScct',
    canonicalName: 'ACEScct',
    aliases: [],
    categories: [],
    family: 'ACES',
    encoding: 'log',
    description: 'ACES log grading space',
    isData: false,
  },
  {
    name: 'sRGB Display',
    canonicalName: 'sRGB Display',
    aliases: [],
    categories: [],
    family: 'Display',
    encoding: 'display',
    description: 'Display-referred sRGB',
    isData: false,
  },
];

describe('working-space candidates', () => {
  it('lists only scene-linear RGB color spaces', () => {
    expect(
      getSceneLinearWorkingSpaceCandidates(colorSpaces).map((colorSpace) => colorSpace.name),
    ).toEqual(['ACEScg', 'ACES2065-1']);
  });

  it.each(['Raw', 'ACEScct', 'sRGB Display'])(
    'rejects %s as a scene working space',
    (colorSpaceName) => {
      const colorSpace = colorSpaces.find((candidate) => candidate.name === colorSpaceName);

      expect(colorSpace).toBeDefined();
      expect(isSceneLinearWorkingSpaceCandidate(colorSpace!)).toBe(false);
      expect(() => assertSceneLinearWorkingSpaceCandidate(colorSpaces, colorSpaceName)).toThrow(
        `Project working-space override "${colorSpaceName}" must be a scene-linear RGB color space.`,
      );
    },
  );

  it('returns the canonical scene-linear color-space name', () => {
    expect(assertSceneLinearWorkingSpaceCandidate(colorSpaces, 'ACEScg')).toBe('ACEScg');
  });
});
