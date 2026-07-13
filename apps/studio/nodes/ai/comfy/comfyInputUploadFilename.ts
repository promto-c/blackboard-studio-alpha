import type { ComfyWorkflowInputCandidate } from '@blackboard/types';

const IMAGE_EXTENSION_BY_MIME_TYPE: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/tiff': 'tif',
  'image/x-tiff': 'tif',
  'application/exr': 'exr',
  'application/x-exr': 'exr',
  'image/exr': 'exr',
  'image/x-exr': 'exr',
  'image/vnd.radiance': 'hdr',
  'image/x-hdr': 'hdr',
  'image/x-rgbe': 'hdr',
};

const sanitizeComfyUploadNamePart = (value: string): string =>
  value
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'input';

const getExtensionFromName = (name: string): string | undefined =>
  name
    .match(/\.(png|jpe?g|webp|gif|avif|bmp|tiff?|exr|hdr)$/i)?.[1]
    ?.toLowerCase()
    .replace('jpeg', 'jpg')
    .replace('tiff', 'tif');

export const getComfyInputUploadFilename = ({
  sourceName,
  candidate,
  blob,
}: {
  sourceName: string;
  candidate: Pick<ComfyWorkflowInputCandidate, 'nodeId' | 'inputName'>;
  blob: Blob;
}): string => {
  const uploadSourceName = sanitizeComfyUploadNamePart(sourceName);
  const inputName = sanitizeComfyUploadNamePart(`${candidate.nodeId}_${candidate.inputName}`);
  // The encoded Blob is authoritative. A rendered PNG can originate from a
  // source named `plate.exr`; retaining `.exr` would make Comfy decode PNG
  // bytes with the wrong loader.
  const extension =
    IMAGE_EXTENSION_BY_MIME_TYPE[blob.type.trim().toLowerCase()] ??
    getExtensionFromName(sourceName) ??
    'png';
  return `${uploadSourceName}_${inputName}_${Date.now()}.${extension}`;
};
