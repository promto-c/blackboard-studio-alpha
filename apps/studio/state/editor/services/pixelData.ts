import { ImageSequenceNode, MediaSourceNode, NodeType } from '@blackboard/types';
import { getAsset } from '@/state/assetStorage';
import { readExrPixelData } from '@/utils/exr';
import { type MediaBlobLike, getBlobName, isExrFileLike } from '@/utils/mediaFiles';

export type PixelDataResult = { data: Uint8ClampedArray; width: number; height: number };

export interface PixelDataReader {
  getFramePixelData: (frame: number) => Promise<PixelDataResult | null>;
  dispose: () => void;
}

const VIDEO_PIXEL_PREFETCH_WINDOW = 5;
const VIDEO_PIXEL_CACHE_FRAME_LIMIT = 32;

const getVideoTargetTime = (frame: number, fps: number, duration: number | undefined): number => {
  const targetTime = Math.max(0, frame / Math.max(fps || 30, 1) + 0.0001);
  return Math.min(targetTime, duration || targetTime);
};

const touchPixelCacheEntry = (
  cache: Map<number, PixelDataResult>,
  frame: number,
): PixelDataResult | null => {
  const result = cache.get(frame);
  if (!result) return null;
  cache.delete(frame);
  cache.set(frame, result);
  return result;
};

const addPixelCacheEntry = (
  cache: Map<number, PixelDataResult>,
  frame: number,
  result: PixelDataResult,
) => {
  cache.set(frame, result);
  while (cache.size > VIDEO_PIXEL_CACHE_FRAME_LIMIT) {
    const oldestFrame = cache.keys().next().value;
    if (oldestFrame === undefined) break;
    cache.delete(oldestFrame);
  }
};

const createVideoPixelDataReader = (node: MediaSourceNode, fps: number): PixelDataReader => {
  let disposed = false;
  let objectUrl: string | null = null;
  let video: HTMLVideoElement | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let context: CanvasRenderingContext2D | null = null;
  let queue = Promise.resolve();
  let lastRequestedFrame: number | null = null;
  const frameCache = new Map<number, PixelDataResult>();
  const pendingFrameDecodes = new Map<number, Promise<PixelDataResult | null>>();

  const ready = (async () => {
    const blob = await getAsset(node.src);
    if (!blob || disposed) return null;

    objectUrl = URL.createObjectURL(blob);
    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = objectUrl;

    await new Promise<void>((resolve, reject) => {
      if (!video) {
        reject(new Error('Video reader was disposed.'));
        return;
      }
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('Video failed to load.'));
      video.load();
    });

    return video;
  })();

  const captureCurrentFrame = (targetFrame: number): PixelDataResult | null => {
    if (!video) return null;

    if (!canvas) {
      canvas = document.createElement('canvas');
      context = canvas.getContext('2d');
    }
    if (!context || !canvas) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0);

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = {
      data: imageData.data,
      width: canvas.width,
      height: canvas.height,
    };
    addPixelCacheEntry(frameCache, targetFrame, result);
    return result;
  };

  const decodeFrame = async (targetFrame: number): Promise<PixelDataResult | null> => {
    const cached = touchPixelCacheEntry(frameCache, targetFrame);
    if (cached || disposed) return cached;

    const loadedVideo = await ready;
    if (!loadedVideo || disposed) return null;

    const targetTime = getVideoTargetTime(targetFrame, fps, loadedVideo.duration);
    const tolerance = 0.5 / Math.max(fps || 30, 1);

    if (Math.abs(loadedVideo.currentTime - targetTime) > tolerance) {
      await new Promise<void>((resolve, reject) => {
        loadedVideo.onseeked = () => resolve();
        loadedVideo.onerror = () => reject(new Error('Video failed to seek.'));
        loadedVideo.currentTime = targetTime;
      });
    }

    return captureCurrentFrame(targetFrame);
  };

  const requestFrameDecode = (targetFrame: number): Promise<PixelDataResult | null> => {
    const cached = touchPixelCacheEntry(frameCache, targetFrame);
    if (cached || disposed) return Promise.resolve(cached);

    const pending = pendingFrameDecodes.get(targetFrame);
    if (pending) return pending;

    const decode = queue.then(() => decodeFrame(targetFrame));
    queue = decode.then(
      () => undefined,
      () => undefined,
    );
    pendingFrameDecodes.set(targetFrame, decode);

    decode.then(
      () => pendingFrameDecodes.delete(targetFrame),
      () => pendingFrameDecodes.delete(targetFrame),
    );

    return decode;
  };

  const prefetchAroundFrame = (targetFrame: number, direction: 1 | -1) => {
    for (let offset = 1; offset <= VIDEO_PIXEL_PREFETCH_WINDOW; offset += 1) {
      const frame = targetFrame + direction * offset;
      if (frame < 0) break;
      if (frameCache.has(frame) || pendingFrameDecodes.has(frame)) continue;
      void requestFrameDecode(frame).catch(() => null);
    }
  };

  return {
    getFramePixelData: async (frame) => {
      const targetFrame = Math.max(0, Math.round(frame));
      const direction = lastRequestedFrame !== null && targetFrame < lastRequestedFrame ? -1 : 1;
      lastRequestedFrame = targetFrame;

      const cached = touchPixelCacheEntry(frameCache, targetFrame);
      if (cached || disposed) {
        if (cached) prefetchAroundFrame(targetFrame, direction);
        return cached;
      }

      try {
        const result = await requestFrameDecode(targetFrame);
        prefetchAroundFrame(targetFrame, direction);
        return result;
      } catch {
        return null;
      }
    },
    dispose: () => {
      disposed = true;
      frameCache.clear();
      pendingFrameDecodes.clear();
      if (video) {
        video.pause();
        video.src = '';
        video.load();
        video = null;
      }
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      canvas = null;
      context = null;
    },
  };
};

export const createPixelDataReader = (
  node: MediaSourceNode | ImageSequenceNode,
  fps: number,
): PixelDataReader => {
  if (node.type === NodeType.MEDIA_SOURCE && node.mediaKind === 'video') {
    return createVideoPixelDataReader(node, fps);
  }

  return {
    getFramePixelData: (frame) =>
      getPixelDataForFrame(node as MediaSourceNode | ImageSequenceNode, frame),
    dispose: () => {},
  };
};

/**
 * Loads the pixel data for a single frame of an image or image-sequence
 * node from the asset store.  All DOM work is self-contained so callers do not
 * need to manage object URLs or canvas elements.
 */
export async function getPixelDataForFrame(
  node: MediaSourceNode | ImageSequenceNode,
  frame: number,
): Promise<PixelDataResult | null> {
  let assetId = '';
  if (node.type === NodeType.MEDIA_SOURCE && node.mediaKind === 'image') {
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

  if (isExrFileLike(assetBlob, getBlobName(assetBlob))) {
    return readExrPixelData(assetBlob, { cacheKey: assetId });
  }

  const objectUrl = URL.createObjectURL(blob);

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
