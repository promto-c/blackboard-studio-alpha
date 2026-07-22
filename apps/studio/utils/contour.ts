export type ContourPoint = { x: number; y: number };

type Segment = [ContourPoint, ContourPoint];

const pointKey = (point: ContourPoint): string =>
  `${Math.round(point.x * 2)},${Math.round(point.y * 2)}`;

const buildSegments = (
  values: ArrayLike<number>,
  width: number,
  height: number,
  threshold: number,
): Segment[] => {
  const segments: Segment[] = [];

  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const index = y * width + x;
      const topLeft = values[index] >= threshold ? 1 : 0;
      const topRight = values[index + 1] >= threshold ? 1 : 0;
      const bottomRight = values[index + width + 1] >= threshold ? 1 : 0;
      const bottomLeft = values[index + width] >= threshold ? 1 : 0;
      const configuration = (topLeft << 3) | (topRight << 2) | (bottomRight << 1) | bottomLeft;
      if (configuration === 0 || configuration === 15) continue;

      const top = { x: x + 0.5, y };
      const right = { x: x + 1, y: y + 0.5 };
      const bottom = { x: x + 0.5, y: y + 1 };
      const left = { x, y: y + 0.5 };

      switch (configuration) {
        case 1:
        case 14:
          segments.push([bottom, left]);
          break;
        case 2:
        case 13:
          segments.push([right, bottom]);
          break;
        case 3:
        case 12:
          segments.push([right, left]);
          break;
        case 4:
        case 11:
          segments.push([top, right]);
          break;
        case 5:
          segments.push([top, left], [right, bottom]);
          break;
        case 6:
        case 9:
          segments.push([top, bottom]);
          break;
        case 7:
        case 8:
          segments.push([top, left]);
          break;
        case 10:
          segments.push([top, right], [bottom, left]);
          break;
      }
    }
  }

  return segments;
};

/** Assemble marching-squares segments in O(n) instead of scanning every segment per point. */
const assembleSegments = (segments: Segment[]): ContourPoint[][] => {
  const incident = new Map<string, number[]>();
  segments.forEach((segment, segmentIndex) => {
    segment.forEach((point) => {
      const key = pointKey(point);
      const matches = incident.get(key);
      if (matches) matches.push(segmentIndex);
      else incident.set(key, [segmentIndex]);
    });
  });

  const used = new Uint8Array(segments.length);
  const contours: ContourPoint[][] = [];

  const extend = (path: ContourPoint[], atStart: boolean): void => {
    while (true) {
      const endpoint = atStart ? path[0] : path[path.length - 1];
      const candidateIndex = incident.get(pointKey(endpoint))?.find((index) => !used[index]);
      if (candidateIndex == null) return;

      used[candidateIndex] = 1;
      const [a, b] = segments[candidateIndex];
      const next = pointKey(a) === pointKey(endpoint) ? b : a;
      if (atStart) path.unshift(next);
      else path.push(next);

      if (path.length > 3 && pointKey(path[0]) === pointKey(path[path.length - 1])) return;
    }
  };

  segments.forEach((segment, segmentIndex) => {
    if (used[segmentIndex]) return;
    used[segmentIndex] = 1;
    const path = [segment[0], segment[1]];
    extend(path, false);
    extend(path, true);
    if (path.length > 5) contours.push(path);
  });

  return contours;
};

export const findScalarContours = (
  values: ArrayLike<number>,
  width: number,
  height: number,
  threshold: number,
): ContourPoint[][] => {
  if (width < 2 || height < 2 || values.length < width * height) return [];
  return assembleSegments(buildSegments(values, width, height, threshold));
};

/** Find contours in a one-byte mask where 0 is background and 255 is foreground. */
export const findMaskContours = (
  data: Uint8Array,
  width: number,
  height: number,
  threshold = 0.5,
): ContourPoint[][] => {
  if (width < 1 || height < 1 || data.length < width * height) return [];
  const paddedWidth = width + 2;
  const paddedHeight = height + 2;
  const padded = new Uint8Array(paddedWidth * paddedHeight);
  for (let y = 0; y < height; y += 1) {
    padded.set(data.subarray(y * width, (y + 1) * width), (y + 1) * paddedWidth + 1);
  }
  return findScalarContours(padded, paddedWidth, paddedHeight, threshold * 255).map((contour) =>
    contour.map((point) => ({
      x: Math.max(0, Math.min(width, point.x - 1)),
      y: Math.max(0, Math.min(height, point.y - 1)),
    })),
  );
};

/**
 * Marching Squares implementation for an RGBA image channel.
 * Returns an array of paths in pixel coordinates.
 */
export function findContours(
  data: Uint8Array,
  width: number,
  height: number,
  threshold: number,
  channelOffset: number,
): ContourPoint[][] {
  const values = new Uint8Array(width * height);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = data[index * 4 + channelOffset];
  }
  return findScalarContours(values, width, height, threshold * 255);
}

export const getContourArea = (contour: readonly ContourPoint[]): number => {
  if (contour.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < contour.length; index += 1) {
    const current = contour[index];
    const next = contour[(index + 1) % contour.length];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area) / 2;
};

export const getLargestContour = (contours: readonly ContourPoint[][]): ContourPoint[] | null => {
  let largest: ContourPoint[] | null = null;
  let largestArea = 0;
  contours.forEach((contour) => {
    const area = getContourArea(contour);
    if (area > largestArea) {
      largestArea = area;
      largest = contour;
    }
  });
  return largest;
};
