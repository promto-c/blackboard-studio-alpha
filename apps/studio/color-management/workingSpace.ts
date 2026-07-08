import type { ColorSpaceInfo } from './types';
import { resolveCanonicalColorSpaceName } from './roles';

type WorkingSpaceColorSpace = Pick<
  ColorSpaceInfo,
  'name' | 'canonicalName' | 'encoding' | 'isData'
>;

const normalizeColorMetadata = (value: string | undefined | null): string =>
  (value ?? '').trim().toLowerCase();

export const isSceneLinearWorkingSpaceCandidate = (colorSpace: WorkingSpaceColorSpace): boolean => {
  if (colorSpace.isData) return false;
  const encoding = normalizeColorMetadata(colorSpace.encoding).replace(/[\s_]+/g, '-');
  return encoding === 'scene-linear';
};

export const getSceneLinearWorkingSpaceCandidates = <T extends WorkingSpaceColorSpace>(
  colorSpaces: readonly T[],
): T[] => colorSpaces.filter(isSceneLinearWorkingSpaceCandidate);

export const assertSceneLinearWorkingSpaceCandidate = (
  colorSpaces: readonly WorkingSpaceColorSpace[],
  colorSpaceName: string | undefined | null,
  label = 'Project working-space override',
): string => {
  const trimmed = colorSpaceName?.trim();
  if (!trimmed) {
    throw new Error(`${label} must define a color space.`);
  }

  const colorSpace = colorSpaces.find(
    (candidate) => candidate.name === trimmed || candidate.canonicalName === trimmed,
  );
  const canonicalName = resolveCanonicalColorSpaceName(colorSpaces, trimmed);
  if (!colorSpace || !canonicalName) {
    throw new Error(`${label} "${trimmed}" is not defined by the active OCIO config.`);
  }

  if (!isSceneLinearWorkingSpaceCandidate(colorSpace)) {
    throw new Error(`${label} "${canonicalName}" must be a scene-linear RGB color space.`);
  }

  return canonicalName;
};
