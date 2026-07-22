// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeType, RotoDrawMode, RotoPathBlend, RotoShapeType } from '@blackboard/types';
import { drawRotoPathGeometry } from '@/utils/rotoMaskRaster';
import { resolveRotoPathPointsAtFrame } from '@/utils/rotoTracking';
import {
  getRotoControlOwnershipSamples,
  rasterizeRotoShapeForAnalysis,
  rasterPointToScenePoint,
  scenePointToRasterPoint,
} from './rotoShapeRaster';

vi.mock('@/utils/rotoMaskRaster', () => ({
  drawRotoPathGeometry: vi.fn(),
}));

vi.mock('@/utils/rotoTracking', () => ({
  resolveRotoPathPointsAtFrame: vi.fn(),
}));

const node = {
  id: 'roto-1',
  type: NodeType.ROTO,
  name: 'Roto',
  enabled: true,
  invert: false,
  paths: [],
};

const path = {
  id: 'shape-1',
  name: 'Stroke-only source',
  shapeType: RotoShapeType.POLYGON,
  points: [
    { x: 10, y: 20 },
    { x: 110, y: 20 },
    { x: 110, y: 70 },
    { x: 10, y: 70 },
  ],
  closed: true,
  feather: 0,
  opacity: 15,
  blend: RotoPathBlend.ADD,
  style: { mode: RotoDrawMode.STROKE, strokeWidth: 8 },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('rasterizeRotoShapeForAnalysis', () => {
  it('maps B-spline controls to their rendered curve neighborhoods', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 12 },
      { x: 0, y: 12 },
    ];
    const neighborhoods = getRotoControlOwnershipSamples(
      { ...path, shapeType: RotoShapeType.BSPLINE },
      points,
    );

    expect(neighborhoods).toHaveLength(points.length);
    expect(neighborhoods[0]).toHaveLength(3);
    expect(neighborhoods[0][1]).toEqual({ x: 2, y: 2 });
    expect(neighborhoods[0][1]).not.toEqual(points[0]);
  });

  it('creates a temporary cropped fill raster and maps its pixels back to the scene', () => {
    vi.mocked(resolveRotoPathPointsAtFrame).mockReturnValue([
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 70 },
      { x: 10, y: 70 },
    ]);
    const rgba = new Uint8ClampedArray(104 * 54 * 4);
    rgba[3] = 255;
    rgba[7] = 127;
    const context = {
      setTransform: vi.fn(),
      resetTransform: vi.fn(),
      getImageData: vi.fn(() => ({ data: rgba })),
      fillStyle: '',
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);

    const raster = rasterizeRotoShapeForAnalysis(node as never, path as never, 12, {
      width: 1920,
      height: 1080,
    });

    expect(raster).toMatchObject({
      width: 104,
      height: 54,
      sceneBounds: { x: 8, y: 18, width: 104, height: 54 },
    });
    expect(raster?.mask[0]).toBe(255);
    expect(raster?.mask[1]).toBe(0);
    expect(context.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, -968, -558);
    expect(context.resetTransform).toHaveBeenCalledOnce();
    expect(drawRotoPathGeometry).toHaveBeenCalledWith(
      context,
      node,
      expect.objectContaining({
        closed: true,
        style: expect.objectContaining({ mode: RotoDrawMode.FILL }),
      }),
      12,
      1920,
      1080,
    );
    expect(rasterPointToScenePoint(raster!, { x: 52, y: 27 })).toEqual({ x: 60, y: 45 });
    expect(scenePointToRasterPoint(raster!, { x: 60, y: 45 })).toEqual({ x: 52, y: 27 });
  });

  it('does not rasterize open paths', () => {
    expect(
      rasterizeRotoShapeForAnalysis(node as never, { ...path, closed: false } as never, 0, {
        width: 1920,
        height: 1080,
      }),
    ).toBeNull();
    expect(drawRotoPathGeometry).not.toHaveBeenCalled();
  });
});
