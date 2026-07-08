import type { MediaColorManagement } from '@blackboard/types';
import { ColorManagementDefaults } from './constants';
import { resolveMediaColorAssignmentPipeline, type MediaColorAssignmentCandidate } from './media';

const EXR_COLOR_SPACE_ATTRIBUTE = 'ocioColorSpace';
const CHROMATICITY_TOLERANCE = 0.0001;

interface Chromaticities {
  redX: number;
  redY: number;
  greenX: number;
  greenY: number;
  blueX: number;
  blueY: number;
  whiteX: number;
  whiteY: number;
}

export interface ParsedMediaColorMetadata {
  candidate: MediaColorAssignmentCandidate | null;
  camera?: {
    vendor?: string;
    model?: string;
    serial?: string;
  };
  imageProfile?: string;
  chromaticities?: Chromaticities;
}

const ACES_AP0: Chromaticities = {
  redX: 0.7347,
  redY: 0.2653,
  greenX: 0,
  greenY: 1,
  blueX: 0.0001,
  blueY: -0.077,
  whiteX: 0.32168,
  whiteY: 0.33767,
};

const ACES_AP1: Chromaticities = {
  redX: 0.713,
  redY: 0.293,
  greenX: 0.165,
  greenY: 0.83,
  blueX: 0.128,
  blueY: 0.044,
  whiteX: 0.32168,
  whiteY: 0.33767,
};

const unwrapAttributeValue = (value: unknown): unknown => {
  if (!value || typeof value !== 'object' || !('value' in value)) return value;
  return (value as { value: unknown }).value;
};

const getStringAttribute = (
  attributes: Readonly<Record<string, unknown>>,
  names: readonly string[],
): string | undefined => {
  for (const name of names) {
    const value = unwrapAttributeValue(attributes[name]);
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
};

const getBooleanAttribute = (
  attributes: Readonly<Record<string, unknown>>,
  name: string,
): boolean => {
  const value = unwrapAttributeValue(attributes[name]);
  return value === true || value === 1;
};

const getChromaticities = (
  attributes: Readonly<Record<string, unknown>>,
): Chromaticities | undefined => {
  const value = unwrapAttributeValue(attributes.chromaticities);
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<keyof Chromaticities, unknown>;
  const keys = Object.keys(ACES_AP0) as Array<keyof Chromaticities>;
  if (!keys.every((key) => typeof candidate[key] === 'number')) return undefined;
  return Object.fromEntries(keys.map((key) => [key, candidate[key]])) as unknown as Chromaticities;
};

const matchesChromaticities = (value: Chromaticities, reference: Chromaticities): boolean =>
  (Object.keys(reference) as Array<keyof Chromaticities>).every(
    (key) => Math.abs(value[key] - reference[key]) <= CHROMATICITY_TOLERANCE,
  );

export const parseExrColorMetadata = (
  attributes: Readonly<Record<string, unknown>>,
): ParsedMediaColorMetadata => {
  const explicitColorSpace = getStringAttribute(attributes, [EXR_COLOR_SPACE_ATTRIBUTE]);
  const chromaticities = getChromaticities(attributes);
  const imageProfile = getStringAttribute(attributes, [
    'iccProfileName',
    'imageProfile',
    'profileName',
  ]);
  const vendor = getStringAttribute(attributes, [
    'cameraMake',
    'cameraManufacturer',
    'manufacturer',
  ]);
  const model = getStringAttribute(attributes, ['cameraModel', 'model']);
  const serial = getStringAttribute(attributes, ['cameraSerialNumber', 'cameraSerial']);

  let candidate: MediaColorAssignmentCandidate | null = null;
  if (explicitColorSpace) {
    candidate = {
      sourceColorSpace: explicitColorSpace,
      detail: `EXR ${EXR_COLOR_SPACE_ATTRIBUTE} metadata`,
    };
  } else if (getBooleanAttribute(attributes, 'acesImageContainerFlag')) {
    candidate = {
      sourceColorSpace: 'ACES2065-1',
      detail: 'EXR ACES image-container metadata',
    };
  } else if (chromaticities && matchesChromaticities(chromaticities, ACES_AP0)) {
    candidate = {
      sourceColorSpace: 'ACES2065-1',
      detail: 'EXR ACES AP0 chromaticities',
    };
  } else if (chromaticities && matchesChromaticities(chromaticities, ACES_AP1)) {
    candidate = {
      sourceColorSpace: 'ACEScg',
      detail: 'EXR ACES AP1 chromaticities',
    };
  } else if (imageProfile?.toLowerCase().includes('srgb')) {
    candidate = {
      sourceColorSpace: ColorManagementDefaults.TEXTURE_SPACE,
      detail: `EXR image profile: ${imageProfile}`,
    };
  }

  return {
    candidate,
    ...(vendor || model || serial ? { camera: { vendor, model, serial } } : {}),
    ...(imageProfile ? { imageProfile } : {}),
    ...(chromaticities ? { chromaticities } : {}),
  };
};

export const getExrColorSpaceMetadataCandidate = (
  attributes: Readonly<Record<string, unknown>>,
): MediaColorAssignmentCandidate | null => parseExrColorMetadata(attributes).candidate;

export const extractMediaColorMetadataCandidate = async (
  blob: Blob,
  isOpenExr: boolean,
): Promise<MediaColorAssignmentCandidate | null> => {
  if (!isOpenExr) return null;

  const { parseExrStructure } = await import('@bb-studio/exr');
  const structure = parseExrStructure(await blob.arrayBuffer());
  const part = structure.parts.find((candidate) => candidate.dataWindow) ?? structure.parts[0];
  return part ? parseExrColorMetadata(part.attributes).candidate : null;
};

export const resolveImportedMediaColorManagement = async ({
  blob,
  fileName,
  isOpenExr,
  resolveConfiguredColorSpaceName,
  resolveFileRule,
}: {
  blob: Blob;
  fileName: string;
  isOpenExr: boolean;
  resolveConfiguredColorSpaceName: (value: string) => string;
  resolveFileRule: (fileName: string) => MediaColorAssignmentCandidate;
}): Promise<MediaColorManagement> => {
  const metadata = await extractMediaColorMetadataCandidate(blob, isOpenExr);
  const resolvedMetadata = metadata
    ? {
        ...metadata,
        sourceColorSpace: resolveConfiguredColorSpaceName(metadata.sourceColorSpace),
      }
    : null;

  const fileRule = resolveFileRule(fileName);
  const resolvedFileRule = fileRule.sourceColorSpace
    ? {
        ...fileRule,
        sourceColorSpace: resolveConfiguredColorSpaceName(fileRule.sourceColorSpace),
      }
    : fileRule;

  return resolveMediaColorAssignmentPipeline({
    metadata: resolvedMetadata,
    fileRule: resolvedFileRule,
  });
};
