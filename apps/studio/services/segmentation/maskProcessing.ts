import { encodePngRgba } from '@/utils/pngRgba';

export interface SegmentationCleanupSettings {
  threshold: number;
  removeSpecks: number;
  fillHoles: number;
  contourDetail: number;
}

export const DEFAULT_SEGMENTATION_CLEANUP: SegmentationCleanupSettings = {
  threshold: 0,
  removeSpecks: 64,
  fillHoles: 64,
  contourDetail: 2,
};

const rewriteSmallComponents = ({
  mask,
  width,
  height,
  target,
  replacement,
  maxArea,
  preserveBoundary,
  includeDiagonals,
  visited,
  queue,
}: {
  mask: Uint8Array;
  width: number;
  height: number;
  target: number;
  replacement: number;
  maxArea: number;
  preserveBoundary: boolean;
  includeDiagonals: boolean;
  visited: Uint8Array;
  queue: Int32Array;
}): void => {
  if (maxArea <= 0) return;
  visited.fill(0);

  for (let seed = 0; seed < mask.length; seed += 1) {
    if (visited[seed] || mask[seed] !== target) continue;
    let readIndex = 0;
    let writeIndex = 0;
    let touchesBoundary = false;
    queue[writeIndex++] = seed;
    visited[seed] = 1;

    while (readIndex < writeIndex) {
      const index = queue[readIndex++];
      const x = index % width;
      const y = Math.floor(index / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBoundary = true;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if ((dx === 0 && dy === 0) || (!includeDiagonals && dx !== 0 && dy !== 0)) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const neighbor = nextY * width + nextX;
          if (!visited[neighbor] && mask[neighbor] === target) {
            visited[neighbor] = 1;
            queue[writeIndex++] = neighbor;
          }
        }
      }
    }

    if (writeIndex <= maxArea && (!preserveBoundary || !touchesBoundary)) {
      for (let index = 0; index < writeIndex; index += 1) mask[queue[index]] = replacement;
    }
  }
};

export const thresholdSegmentationLogits = (
  logits: Float32Array,
  threshold: number,
): Uint8Array => {
  const mask = new Uint8Array(logits.length);
  for (let index = 0; index < logits.length; index += 1) {
    mask[index] = logits[index] > threshold ? 255 : 0;
  }
  return mask;
};

export const cleanSegmentationMask = (
  logits: Float32Array,
  width: number,
  height: number,
  settings: Pick<SegmentationCleanupSettings, 'threshold' | 'removeSpecks' | 'fillHoles'>,
): Uint8Array => {
  const mask = thresholdSegmentationLogits(logits, settings.threshold);
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  rewriteSmallComponents({
    mask,
    width,
    height,
    target: 255,
    replacement: 0,
    maxArea: Math.round(settings.removeSpecks),
    preserveBoundary: false,
    includeDiagonals: true,
    visited,
    queue,
  });
  rewriteSmallComponents({
    mask,
    width,
    height,
    target: 0,
    replacement: 255,
    maxArea: Math.round(settings.fillHoles),
    preserveBoundary: true,
    includeDiagonals: false,
    visited,
    queue,
  });
  return mask;
};

const maskToRgba = (
  mask: Uint8Array,
  color: readonly [number, number, number],
  foregroundAlpha: number,
  opaqueBackground: boolean,
): Uint8Array => {
  const rgba = new Uint8Array(mask.length * 4);
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    const foreground = mask[index] > 0;
    rgba[offset] = foreground ? color[0] : 0;
    rgba[offset + 1] = foreground ? color[1] : 0;
    rgba[offset + 2] = foreground ? color[2] : 0;
    rgba[offset + 3] = foreground ? foregroundAlpha : opaqueBackground ? 255 : 0;
  }
  return rgba;
};

export const createSegmentationPreviewBlob = (
  mask: Uint8Array,
  width: number,
  height: number,
): Promise<Blob> =>
  encodePngRgba({
    data: maskToRgba(mask, [56, 189, 248], 148, false),
    width,
    height,
  });

export const createSegmentationMaskBlob = (
  mask: Uint8Array,
  width: number,
  height: number,
): Promise<Blob> =>
  encodePngRgba({
    data: maskToRgba(mask, [255, 255, 255], 255, true),
    width,
    height,
  });
