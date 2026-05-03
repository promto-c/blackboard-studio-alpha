import { ImageNode, ImageSequenceNode, NodeType, VideoNode } from '@blackboard/types';
import { getAsset } from '@/state/assetStorage';
import { readExrPixelData } from '@/utils/exr';
import { type MediaBlobLike, getBlobName, isExrFileLike } from '@/utils/mediaFiles';

export type PixelDataResult = { data: Uint8ClampedArray; width: number; height: number };

/**
 * Loads the pixel data for a single frame of an image, video, or image-sequence
 * node from the asset store.  All DOM work is self-contained so callers do not
 * need to manage object URLs or canvas elements.
 */
export async function getPixelDataForFrame(
  node: ImageNode | VideoNode | ImageSequenceNode,
  frame: number,
  fps: number,
): Promise<PixelDataResult | null> {
  let assetId = '';
  if (node.type === NodeType.IMAGE) {
    assetId = node.src;
  } else if (node.type === NodeType.VIDEO) {
    assetId = node.src;
  } else if (node.type === NodeType.IMAGE_SEQUENCE) {
    const index = Math.floor(frame) % node.frames.length;
    const safeIndex = (index + node.frames.length) % node.frames.length;
    assetId = node.frames[safeIndex];
  }

  if (!assetId) return null;

  const blob = await getAsset(assetId);
  if (!blob) return null;
  const assetBlob = blob as MediaBlobLike;

  if (node.type !== NodeType.VIDEO && isExrFileLike(assetBlob, getBlobName(assetBlob))) {
    return readExrPixelData(assetBlob, { cacheKey: assetId });
  }

  const objectUrl = URL.createObjectURL(blob);

  if (node.type === NodeType.VIDEO) {
    return new Promise<PixelDataResult | null>((resolve) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.src = objectUrl;

      const targetTime = frame / fps + 0.0001;

      const timeoutId = setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
        resolve(null);
      }, 5000);

      video.onloadedmetadata = () => {
        video.currentTime = targetTime;
      };

      video.onseeked = () => {
        clearTimeout(timeoutId);
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d');
        if (context) {
          context.drawImage(video, 0, 0);
          const pixelData = context.getImageData(0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(objectUrl);
          resolve({
            data: pixelData.data,
            width: canvas.width,
            height: canvas.height,
          });
        } else {
          URL.revokeObjectURL(objectUrl);
          resolve(null);
        }
      };

      video.onerror = () => {
        clearTimeout(timeoutId);
        URL.revokeObjectURL(objectUrl);
        resolve(null);
      };
    });
  }

  const image = new Image();
  image.src = objectUrl;
  await new Promise((resolve) => {
    image.onload = () => resolve(undefined);
  });

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    URL.revokeObjectURL(objectUrl);
    return null;
  }
  context.drawImage(image, 0, 0);
  const pixelData = context.getImageData(0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(objectUrl);

  return { data: pixelData.data, width: canvas.width, height: canvas.height };
}
