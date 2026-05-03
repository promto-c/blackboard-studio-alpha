type Point = { x: number; y: number };

/**
 * Marching Squares implementation to find contours in a bitmask.
 * Returns an array of paths (arrays of points).
 */
export function findContours(
  data: Uint8Array,
  width: number,
  height: number,
  threshold: number,
  channelOffset: number, // 0:R, 1:G, 2:B, 3:A
): Point[][] {
  const values = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    values[i] = data[i * 4 + channelOffset] / 255.0;
  }

  const segments: [Point, Point][] = [];

  // Step 1: Generate segments using Marching Squares
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const idx = y * width + x;
      const v0 = values[idx] >= threshold ? 1 : 0;
      const v1 = values[idx + 1] >= threshold ? 1 : 0;
      const v2 = values[idx + width + 1] >= threshold ? 1 : 0;
      const v3 = values[idx + width] >= threshold ? 1 : 0;

      const config = (v0 << 3) | (v1 << 2) | (v2 << 1) | v3;
      if (config === 0 || config === 15) continue;

      const p0 = { x: x + 0.5, y: y };
      const p1 = { x: x + 1, y: y + 0.5 };
      const p2 = { x: x + 0.5, y: y + 1 };
      const p3 = { x: x, y: y + 0.5 };

      switch (config) {
        case 1:
        case 14:
          segments.push([p2, p3]);
          break;
        case 2:
        case 13:
          segments.push([p1, p2]);
          break;
        case 3:
        case 12:
          segments.push([p1, p3]);
          break;
        case 4:
        case 11:
          segments.push([p0, p1]);
          break;
        case 5:
          segments.push([p0, p3], [p1, p2]);
          break;
        case 6:
        case 9:
          segments.push([p0, p2]);
          break;
        case 7:
        case 8:
          segments.push([p0, p3]);
          break;
        case 10:
          segments.push([p0, p1], [p2, p3]);
          break;
      }
    }
  }

  // Step 2: Assemble segments into connected paths
  const paths: Point[][] = [];
  const used = new Set<number>();

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;

    const path: Point[] = [segments[i][0], segments[i][1]];
    used.add(i);

    let found = true;
    while (found) {
      found = false;
      const last = path[path.length - 1];
      for (let j = 0; j < segments.length; j++) {
        if (used.has(j)) continue;
        const [s0, s1] = segments[j];
        if (Math.abs(s0.x - last.x) < 0.1 && Math.abs(s0.y - last.y) < 0.1) {
          path.push(s1);
          used.add(j);
          found = true;
          break;
        } else if (Math.abs(s1.x - last.x) < 0.1 && Math.abs(s1.y - last.y) < 0.1) {
          path.push(s0);
          used.add(j);
          found = true;
          break;
        }
      }
    }
    if (path.length > 5) {
      paths.push(path);
    }
  }

  return paths;
}
