import { describe, expect, it } from 'vitest';
import { sampleBSplinePoints } from './bspline';
import {
  createSeamAwareRotoContour,
  separateRotoMaskIntoParts,
  simplifyRotoPartContour,
} from './rotoPartSeparation';

const createMask = (rows: readonly string[]): Uint8Array =>
  Uint8Array.from(rows.flatMap((row) => [...row].map((value) => (value === '#' ? 255 : 0))));

const articulatedMaskRows = [
  '...................',
  '..##..##..##..##...',
  '..##..##..##..##...',
  '..##..##..##..##...',
  '..##############...',
  '..##############...',
  '..##############...',
  '......######.......',
  '......######.......',
  '......######.......',
  '...................',
] as const;

const scaleMaskRows = (rows: readonly string[], scale: number): string[] =>
  rows.flatMap((row) =>
    Array.from({ length: scale }, () => [...row].map((value) => value.repeat(scale)).join('')),
  );

const hasProperSelfIntersection = (points: readonly { x: number; y: number }[]): boolean => {
  const cross = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number },
  ) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const segmentCount = points.length - 1;
  for (let first = 0; first < segmentCount; first += 1) {
    for (let second = first + 2; second < segmentCount; second += 1) {
      if (first === 0 && second === segmentCount - 1) continue;
      const a = points[first];
      const b = points[first + 1];
      const c = points[second];
      const d = points[second + 1];
      const abC = cross(a, b, c);
      const abD = cross(a, b, d);
      const cdA = cross(c, d, a);
      const cdB = cross(c, d, b);
      if (abC * abD < -1e-6 && cdA * cdB < -1e-6) return true;
    }
  }
  return false;
};

describe('separateRotoMaskIntoParts', () => {
  it('reduces an artificial overlap seam to an adaptive compact curve', () => {
    const width = 30;
    const height = 20;
    const source = new Uint8Array(width * height);
    for (let y = 2; y <= 17; y += 1) {
      for (let x = 2; x <= 27; x += 1) source[y * width + x] = 255;
    }
    const denseSeam = Array.from({ length: 14 }, (_, index) => ({
      x: 15 + Math.sin(index * 0.65) * 1.5,
      y: index + 3,
    }));
    const contour = [
      { x: 2, y: 2 },
      { x: 8, y: 2 },
      { x: 15, y: 2 },
      ...denseSeam,
      { x: 15, y: 17 },
      { x: 8, y: 17 },
      { x: 2, y: 17 },
      { x: 2, y: 10 },
    ];

    const reduced = createSeamAwareRotoContour(contour, source, width, height);

    expect(reduced.seamPointCounts).toHaveLength(1);
    expect(reduced.seamPointCounts[0]).toBeGreaterThanOrEqual(2);
    expect(reduced.seamPointCounts[0]).toBeLessThanOrEqual(6);
    expect(reduced.points.length).toBeLessThan(contour.length - 6);
    expect(reduced.points).toContainEqual({ x: 2, y: 2 });
    expect(reduced.points).toContainEqual({ x: 2, y: 17 });
    expect(reduced.pointTypes).not.toContain('corner');
    expect(reduced.pointTypes?.filter((type) => type === 'cardinal').length).toBeGreaterThanOrEqual(
      2,
    );

    const simplified = simplifyRotoPartContour(
      reduced.points,
      reduced.pointTypes,
      4,
      reduced.pointOrigins,
    );
    expect(simplified.pointTypes).not.toContain('corner');
    expect(simplified.points.length).toBeGreaterThanOrEqual(reduced.seamPointCounts[0]);
  });

  it('uses a complex raster cut as a coarse guide instead of tracing it', () => {
    const width = 100;
    const height = 80;
    const source = new Uint8Array(width * height);
    for (let y = 2; y <= 77; y += 1) {
      for (let x = 2; x <= 97; x += 1) source[y * width + x] = 255;
    }
    const createContour = (wave: (y: number) => number) => {
      const seam = Array.from({ length: 74 }, (_, index) => ({
        x: 50 + wave(index + 3),
        y: index + 3,
      }));
      return {
        seam: [{ x: 50, y: 2 }, ...seam, { x: 50, y: 77 }],
        contour: [
          { x: 2, y: 2 },
          { x: 50, y: 2 },
          ...seam,
          { x: 50, y: 77 },
          { x: 2, y: 77 },
          { x: 2, y: 2 },
        ],
      };
    };
    const straightSource = createContour(() => 0);
    const complexSource = createContour(
      (y) => Math.sin((y / 75) * Math.PI * 3) * 10 + Math.sin((y / 75) * Math.PI * 7) * 2,
    );
    const straight = createSeamAwareRotoContour(straightSource.contour, source, width, height);
    const complex = createSeamAwareRotoContour(complexSource.contour, source, width, height);

    expect(straight.seamPointCounts[0]).toBe(4);
    expect(complex.seamPointCounts[0]).toBeGreaterThan(straight.seamPointCounts[0]);
    expect(complex.seamPointCounts[0]).toBeLessThanOrEqual(6);
    expect(complex.seamPointCounts[0]).toBeLessThan(complexSource.seam.length / 10);
    expect(complex.points).toContainEqual(complexSource.seam[0]);
    expect(complex.points).toContainEqual(complexSource.seam.at(-1));
  });

  it('retains every original control exactly and adds only smooth overlap controls', () => {
    const rows = scaleMaskRows(articulatedMaskRows, 6);
    const width = rows[0].length;
    const sourceControls = [
      { x: 12, y: 6 },
      { x: 24, y: 24 },
      { x: 36, y: 6 },
      { x: 48, y: 24 },
      { x: 60, y: 6 },
      { x: 72, y: 24 },
      { x: 84, y: 6 },
      { x: 90, y: 36 },
      { x: 66, y: 48 },
      { x: 48, y: 60 },
      { x: 30, y: 48 },
      { x: 12, y: 36 },
    ];
    const sourcePointTypes = sourceControls.map((_, index) =>
      index === 3 ? ('cardinal' as const) : ('bspline' as const),
    );
    const result = separateRotoMaskIntoParts(
      createMask(rows),
      width,
      rows.length,
      { partCount: 5, overlap: 6, branchReach: 2.5 },
      { points: sourceControls, pointTypes: sourcePointTypes },
    );
    const simplifiedParts = result.parts.map((part) =>
      simplifyRotoPartContour(
        part.editableContour,
        part.editablePointTypes,
        8,
        part.editablePointOrigins,
      ),
    );
    const retainedSourcePoints = simplifiedParts.flatMap((part) =>
      part.points.filter((_, index) => part.pointOrigins?.[index] === 'source'),
    );

    expect(retainedSourcePoints).toHaveLength(sourceControls.length);
    sourceControls.forEach((sourcePoint) =>
      expect(retainedSourcePoints).toContainEqual(sourcePoint),
    );
    result.parts.forEach((part) => {
      part.editablePointOrigins?.forEach((origin, index) => {
        if (origin === 'overlap') expect(part.editablePointTypes?.[index]).not.toBe('corner');
      });
    });
  });

  it('assigns an off-curve B-spline control from its curve neighborhood, not its position', () => {
    const rows = scaleMaskRows(articulatedMaskRows, 6);
    const width = rows[0].length;
    const mask = createMask(rows);
    const control = { x: 84, y: 8 };
    const curveNeighborhood = [
      { x: 12, y: 8 },
      { x: 14, y: 8 },
      { x: 16, y: 8 },
    ];
    const result = separateRotoMaskIntoParts(
      mask,
      width,
      rows.length,
      { partCount: 5, overlap: 0, branchReach: 2.5 },
      { points: [control], ownershipSamples: [curveNeighborhood] },
    );
    const assignedPart = result.parts.find((part) => part.editablePointOrigins?.includes('source'));

    expect(assignedPart).toBeDefined();
    expect(assignedPart?.mask[8 * width + 14]).toBe(255);
    expect(assignedPart?.mask[control.y * width + control.x]).toBe(0);
  });

  it('automatically detects the core and four salient branches', () => {
    const rows = scaleMaskRows(
      [
        '...................',
        '..##..##..##..##...',
        '..##..##..##..##...',
        '..##..##..##..##...',
        '..##############...',
        '..##############...',
        '..##############...',
        '..##############...',
        '...############....',
        '....##########.....',
        '.....########......',
        '......######.......',
        '.......####........',
      ],
      6,
    );
    const width = rows[0].length;
    const result = separateRotoMaskIntoParts(createMask(rows), width, rows.length, {
      partCount: 'auto',
      overlap: 6,
      branchReach: 2.5,
    });

    expect(result.parts).toHaveLength(5);
    expect(result.parts.slice(1).every((part) => part.seed.y < rows.length / 2)).toBe(true);
    result.parts.forEach((part) => {
      const simplified = simplifyRotoPartContour(
        part.editableContour,
        part.editablePointTypes,
        2,
        part.editablePointOrigins,
      );
      const sampled = sampleBSplinePoints(
        simplified.points,
        true,
        undefined,
        12,
        'global',
        simplified.pointTypes,
      );
      expect(hasProperSelfIntersection(sampled)).toBe(false);
    });
  });

  it('produces the same split for an automatic count and that explicit count', () => {
    const width = 180;
    const height = 140;
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const head = ((x - 72) / 58) ** 2 + ((y - 58) / 48) ** 2 <= 1;
        const neck = x >= 50 && x <= 79 && y >= 88 && y <= 125;
        const tailBridge = x >= 119 && x <= 158 && y >= 61 && y <= 65;
        const tail = ((x - 164) / 18) ** 2 + ((y - 63) / 16) ** 2 <= 1;
        if (head || neck || tailBridge || tail) mask[y * width + x] = 255;
      }
    }
    const options = { overlap: 6, branchReach: 2.5 } as const;
    const automatic = separateRotoMaskIntoParts(mask, width, height, {
      ...options,
      partCount: 'auto',
    });
    const explicit = separateRotoMaskIntoParts(mask, width, height, {
      ...options,
      partCount: automatic.parts.length,
    });

    expect(automatic.parts).toHaveLength(2);
    expect(explicit.parts.map((part) => part.seed)).toEqual(
      automatic.parts.map((part) => part.seed),
    );
    expect(explicit.parts.map((part) => part.mask)).toEqual(
      automatic.parts.map((part) => part.mask),
    );
  });

  it('finds a core and distal branches in an articulated silhouette', () => {
    const width = articulatedMaskRows[0].length;
    const result = separateRotoMaskIntoParts(
      createMask(articulatedMaskRows),
      width,
      articulatedMaskRows.length,
      { partCount: 5, overlap: 1, branchReach: 2.5 },
    );

    expect(result.parts).toHaveLength(5);
    expect(result.parts[0].seed.y).toBeGreaterThanOrEqual(4);
    expect(result.parts.slice(1).some((part) => part.seed.y <= 2)).toBe(true);
    result.parts.forEach((part) => {
      expect(part.corePixelCount).toBeGreaterThan(0);
      expect(part.contour.length).toBeGreaterThan(3);
    });
  });

  it('applies the seam point budget to generated overlapping parts', () => {
    const rows = scaleMaskRows(articulatedMaskRows, 6);
    const width = rows[0].length;
    const result = separateRotoMaskIntoParts(createMask(rows), width, rows.length, {
      partCount: 5,
      overlap: 6,
      branchReach: 2.5,
    });
    const seamPointCounts = result.parts.flatMap((part) => part.seamPointCounts);

    expect(seamPointCounts.length).toBeGreaterThan(0);
    expect(seamPointCounts.every((count) => count >= 2 && count <= 6)).toBe(true);
    expect(result.parts.some((part) => part.editableContour.length < part.contour.length)).toBe(
      true,
    );
  });

  it('keeps both sides of each final cut join on the fitted source tangent', () => {
    const rows = scaleMaskRows(articulatedMaskRows, 6);
    const width = rows[0].length;
    const result = separateRotoMaskIntoParts(createMask(rows), width, rows.length, {
      partCount: 5,
      overlap: 6,
      branchReach: 2.5,
    });
    const alignments: number[] = [];
    let startJoinCount = 0;
    let endJoinCount = 0;

    result.parts.forEach((part) => {
      const simplified = simplifyRotoPartContour(
        part.editableContour,
        part.editablePointTypes,
        8,
        part.editablePointOrigins,
      );
      const origins = simplified.pointOrigins ?? [];
      const points = simplified.points;
      for (let index = 0; index < points.length; index += 1) {
        const previousIndex = (index - 1 + points.length) % points.length;
        const nextIndex = (index + 1) % points.length;
        if (origins[index] !== 'overlap') continue;
        const isStartJoin =
          origins[previousIndex] === 'tangent' && origins[nextIndex] === 'overlap';
        const isEndJoin = origins[previousIndex] === 'overlap' && origins[nextIndex] === 'tangent';
        if (!isStartJoin && !isEndJoin) continue;
        const incoming = {
          x: points[index].x - points[previousIndex].x,
          y: points[index].y - points[previousIndex].y,
        };
        const outgoing = {
          x: points[nextIndex].x - points[index].x,
          y: points[nextIndex].y - points[index].y,
        };
        const denominator = Math.max(
          1e-6,
          Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y),
        );
        alignments.push(Math.abs(incoming.x * outgoing.y - incoming.y * outgoing.x) / denominator);
        expect(incoming.x * outgoing.x + incoming.y * outgoing.y).toBeGreaterThan(0);
        expect(simplified.pointTypes?.[index]).toBe('cardinal');
        if (isStartJoin) startJoinCount += 1;
        if (isEndJoin) endJoinCount += 1;
      }
    });

    expect(alignments.length).toBeGreaterThan(0);
    expect(startJoinCount).toBeGreaterThan(0);
    expect(endJoinCount).toBe(startJoinCount);
    expect(Math.max(...alignments)).toBeLessThan(1e-6);
  });

  it('covers the source exactly and creates shared underlap only inside it', () => {
    const width = articulatedMaskRows[0].length;
    const source = createMask(articulatedMaskRows);
    const result = separateRotoMaskIntoParts(source, width, articulatedMaskRows.length, {
      partCount: 5,
      overlap: 2,
      branchReach: 2.5,
    });

    let sharedPixelCount = 0;
    for (let index = 0; index < source.length; index += 1) {
      const membershipCount = result.parts.reduce(
        (count, part) => count + (part.mask[index] > 0 ? 1 : 0),
        0,
      );
      if (result.sourceMask[index] > 0) expect(membershipCount).toBeGreaterThan(0);
      else expect(membershipCount).toBe(0);
      if (membershipCount > 1) sharedPixelCount += 1;
    }
    expect(sharedPixelCount).toBeGreaterThan(0);
  });

  it('moves joints toward the core as branch reach increases', () => {
    const width = articulatedMaskRows[0].length;
    const source = createMask(articulatedMaskRows);
    const balanced = separateRotoMaskIntoParts(source, width, articulatedMaskRows.length, {
      partCount: 2,
      overlap: 0,
      branchReach: 1,
    });
    const extended = separateRotoMaskIntoParts(source, width, articulatedMaskRows.length, {
      partCount: 2,
      overlap: 0,
      branchReach: 4,
    });

    expect(extended.parts[1].corePixelCount).toBeGreaterThan(balanced.parts[1].corePixelCount);
    expect(extended.parts[0].corePixelCount).toBeLessThan(balanced.parts[0].corePixelCount);
  });

  it('ignores detached specks instead of turning them into parts', () => {
    const rows: string[] = [...articulatedMaskRows];
    rows[0] = '.................#.';
    const width = rows[0].length;
    const result = separateRotoMaskIntoParts(createMask(rows), width, rows.length, {
      partCount: 3,
      overlap: 0,
      branchReach: 2.5,
    });

    expect(result.sourceMask[17]).toBe(0);
    expect(result.parts.every((part) => part.mask[17] === 0)).toBe(true);
  });
});
