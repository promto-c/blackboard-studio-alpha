import type {
  MediaColorManagement,
  VideoColorMetadata,
  VideoColorMetadataSource,
  VideoColorPrimaries,
  VideoColorRange,
  VideoMatrixCoefficients,
  VideoTransferCharacteristics,
} from '@blackboard/types';
import { ColorManagementDefaults } from './constants';
import { resolveMediaColorAssignmentPipeline } from './media';

export interface VideoColorMetadataInput {
  primaries?: string | null;
  transfer?: string | null;
  matrix?: string | null;
  range?: string | null;
  fullRange?: boolean | null;
  source?: VideoColorMetadataSource;
}

const normalizeToken = (value: string | null | undefined): string =>
  value
    ?.trim()
    .toLowerCase()
    .replace(/[\s_.]+/g, '-') ?? '';

const PRIMARIES = new Map<string, VideoColorPrimaries>([
  ['bt709', 'bt709'],
  ['rec709', 'bt709'],
  ['bt470bg', 'bt470bg'],
  ['smpte170m', 'smpte170m'],
  ['bt2020', 'bt2020'],
  ['display-p3', 'display-p3'],
  ['smpte-eg-432-1', 'display-p3'],
]);

const TRANSFERS = new Map<string, VideoTransferCharacteristics>([
  ['bt709', 'bt709'],
  ['smpte170m', 'smpte170m'],
  ['srgb', 'srgb'],
  ['iec61966-2-1', 'srgb'],
  ['linear', 'linear'],
  ['pq', 'pq'],
  ['smpte2084', 'pq'],
  ['hlg', 'hlg'],
  ['arib-std-b67', 'hlg'],
]);

const MATRICES = new Map<string, VideoMatrixCoefficients>([
  ['rgb', 'rgb'],
  ['identity', 'rgb'],
  ['bt709', 'bt709'],
  ['bt470bg', 'bt470bg'],
  ['smpte170m', 'smpte170m'],
  ['bt2020-ncl', 'bt2020-ncl'],
  ['bt2020-cl', 'bt2020-cl'],
]);

const normalizeRange = ({
  range,
  fullRange,
}: Pick<VideoColorMetadataInput, 'range' | 'fullRange'>): VideoColorRange | null => {
  if (typeof fullRange === 'boolean') return fullRange ? 'full' : 'limited';
  const token = normalizeToken(range);
  if (token === 'full' || token === 'pc' || token === 'jpeg') return 'full';
  if (token === 'limited' || token === 'tv' || token === 'mpeg') return 'limited';
  return null;
};

export const createVideoColorMetadata = (
  input: VideoColorMetadataInput = {},
): VideoColorMetadata => ({
  primaries: PRIMARIES.get(normalizeToken(input.primaries)) ?? null,
  transfer: TRANSFERS.get(normalizeToken(input.transfer)) ?? null,
  matrix: MATRICES.get(normalizeToken(input.matrix)) ?? null,
  range: normalizeRange(input),
  source: input.source ?? 'unavailable',
});

export const createDecodedVideoColorManagement = (
  sourceColorSpace: string,
  detail: string,
): MediaColorManagement =>
  resolveMediaColorAssignmentPipeline({
    decoder: {
      sourceColorSpace,
      detail,
    },
  });

export const createBrowserDecodedVideoColorManagement = (): MediaColorManagement =>
  createDecodedVideoColorManagement(
    ColorManagementDefaults.TEXTURE_SPACE,
    'Browser/webview-decoded RGB; YUV matrix, transfer decoding, and range expansion are already applied',
  );
