import { describe, expect, it } from 'vitest';
import { BlendMode, ImageFitMode, NodeType, type AnyNode, type PaintNode } from '@blackboard/types';
import {
  applyPaintStrokeToRaster,
  buildPaintStrokeRaster,
  collectPaintStampPoints,
  compositePaintRaster,
  createPaintRaster,
  createPaintStrokePath,
  getPaintTextureCacheKey,
  isStoredPaintAssetId,
  paintNodeHasFrameBoundCloneLifetime,
  paintNodeUsesDynamicCloneSourceAtFrame,
} from './paintRaster';
import { getPaintTextureCommittedState } from './paintTextureKeys';

describe('paint raster helpers', () => {
  it('builds unclamped scene-linear brush stamps without CSS color quantization', () => {
    const raster = buildPaintStrokeRaster({
      tool: 'brush',
      points: [{ x: 0, y: 0 }],
      width: 1,
      height: 1,
      size: 1,
      softness: 0,
      opacity: 50,
      color: [-0.5, 2, 4],
    });

    expect(Array.from(raster?.rgba ?? [])).toEqual([-0.5, 2, 4, 0.5]);
  });

  it('feathers brush coverage while preserving scene-linear RGB', () => {
    const raster = buildPaintStrokeRaster({
      tool: 'brush',
      points: [{ x: 0, y: 0 }],
      width: 3,
      height: 3,
      size: 3,
      softness: 100,
      opacity: 100,
      color: [0.25, 1.5, -0.25],
    });
    const pixels = raster?.rgba ?? new Float32Array();
    const centerOffset = (1 * 3 + 1) * 4;
    const cornerOffset = 0;

    expect(Array.from(pixels.slice(centerOffset, centerOffset + 4))).toEqual([0.25, 1.5, -0.25, 1]);
    expect(pixels[cornerOffset + 3]).toBeLessThan(1);
  });

  it('uses configurable brush spacing when collecting stamps', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];

    expect(collectPaintStampPoints(path, 10)).toHaveLength(11);
    expect(collectPaintStampPoints(path, 25)).toHaveLength(5);
  });

  it('returns null when a stroke has no points', () => {
    expect(createPaintStrokePath([], 24)).toBeNull();
  });

  it('stores short strokes as polyline paths', () => {
    expect(
      createPaintStrokePath(
        [
          { x: -4, y: -2 },
          { x: 8, y: 6 },
        ],
        24,
      ),
    ).toEqual({
      mode: 'polyline',
      points: [
        { x: -4, y: -2 },
        { x: 8, y: 6 },
      ],
    });
  });

  it('keeps curved strokes as bspline-friendly paths', () => {
    const path = createPaintStrokePath(
      [
        { x: 0, y: 0 },
        { x: 12, y: 1 },
        { x: 16, y: 14 },
        { x: 28, y: 16 },
        { x: 32, y: 28 },
      ],
      8,
    );

    expect(path).not.toBeNull();
    expect(path?.mode).toBe('bspline');
    expect(path?.points.length).toBeGreaterThanOrEqual(4);
  });

  it('changes the runtime composite key when stroke render state changes', () => {
    const baseKey = getPaintTextureCacheKey(
      {
        strokes: [
          {
            id: 'stroke_a',
            name: 'Stroke A',
            tool: 'brush',
            visible: true,
            raster: 'asset_a',
            pointCount: 2,
            size: 24,
            spacing: 20,
            softness: 50,
            opacity: 100,
          },
        ],
        layers: [],
      },
      12,
      1920,
      1080,
    );
    const hiddenKey = getPaintTextureCacheKey(
      {
        strokes: [
          {
            id: 'stroke_a',
            name: 'Stroke A',
            tool: 'brush',
            visible: false,
            raster: 'asset_a',
            pointCount: 2,
            size: 24,
            spacing: 20,
            softness: 50,
            opacity: 100,
          },
        ],
        layers: [],
      },
      12,
      1920,
      1080,
    );

    expect(baseKey).not.toBe(hiddenKey);
  });

  it('reuses static paint texture keys across frames when paint lifetimes are all-frame', () => {
    const node: Pick<PaintNode, 'layers' | 'strokes'> = {
      strokes: [
        {
          id: 'stroke_a',
          name: 'Stroke A',
          tool: 'brush',
          visible: true,
          raster: 'asset_a',
          pointCount: 2,
          size: 24,
          spacing: 20,
          softness: 50,
          opacity: 100,
        },
      ],
      layers: [],
    };

    expect(getPaintTextureCacheKey(node, 12, 1920, 1080)).toBe(
      getPaintTextureCacheKey(node, 13, 1920, 1080),
    );
  });

  it('changes paint texture keys across frames when paint lifetimes are frame-bound', () => {
    const node: Pick<PaintNode, 'layers' | 'strokes'> = {
      strokes: [
        {
          id: 'stroke_a',
          name: 'Stroke A',
          tool: 'brush',
          visible: true,
          raster: 'asset_a',
          pointCount: 2,
          size: 24,
          spacing: 20,
          softness: 50,
          opacity: 100,
          lifetime: { mode: 'single', frame: 12 },
        },
      ],
      layers: [],
    };

    expect(getPaintTextureCacheKey(node, 12, 1920, 1080)).not.toBe(
      getPaintTextureCacheKey(node, 13, 1920, 1080),
    );
  });

  it('only uses dynamic clone sources for clone strokes that are frame-bound by lifetime', () => {
    const node: Pick<PaintNode, 'layers' | 'strokes'> = {
      strokes: [
        {
          id: 'stroke_clone',
          name: 'Clone Stroke',
          tool: 'clone',
          visible: true,
          raster: 'asset_clone',
          pointCount: 2,
          size: 24,
          spacing: 20,
          softness: 50,
          opacity: 100,
          path: {
            mode: 'polyline',
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 10 },
            ],
          },
          cloneOffset: { x: 12, y: -8 },
          lifetime: { mode: 'single', frame: 12 },
        },
      ],
      layers: [],
    };

    expect(paintNodeHasFrameBoundCloneLifetime(node)).toBe(true);
    expect(paintNodeUsesDynamicCloneSourceAtFrame(node, 12)).toBe(true);
    expect(paintNodeUsesDynamicCloneSourceAtFrame(node, 13)).toBe(false);
  });

  it('rebuilds all-frame clone strokes when the upstream stack varies by frame', () => {
    const paintNode: PaintNode = {
      id: 'paint_1',
      type: NodeType.PAINT,
      name: 'Paint',
      enabled: true,
      strokes: [
        {
          id: 'stroke_clone',
          name: 'Clone Stroke',
          tool: 'clone',
          visible: true,
          raster: 'asset_clone',
          pointCount: 2,
          size: 24,
          spacing: 20,
          softness: 50,
          opacity: 100,
          path: {
            mode: 'polyline',
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 10 },
            ],
          },
          cloneOffset: { x: 12, y: -8 },
        },
      ],
      layers: [],
      defaultLifetime: null,
    };
    const nodes: AnyNode[] = [
      {
        id: 'scene_1',
        type: NodeType.SCENE,
        name: 'Scene',
        enabled: true,
        width: 1920,
        height: 1080,
        bitDepth: 8,
        colorSpace: 'sRGB',
        maxFrames: 120,
        fps: 24,
      },
      {
        id: 'video_1',
        type: NodeType.MEDIA_SOURCE,
        name: 'Video',
        enabled: true,
        mediaKind: 'video',
        src: 'video_asset',
        width: 1920,
        height: 1080,
        opacity: 100,
        operator: BlendMode.OVER,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.FIT },
        duration: 120,
      },
      paintNode,
    ];

    const frame12 = getPaintTextureCommittedState({
      node: paintNode,
      nodes,
      frame: 12,
      width: 1920,
      height: 1080,
    });
    const frame13 = getPaintTextureCommittedState({
      node: paintNode,
      nodes,
      frame: 13,
      width: 1920,
      height: 1080,
    });

    expect(frame12.requiresDynamicCloneSource).toBe(true);
    expect(frame13.requiresDynamicCloneSource).toBe(true);
    expect(frame12.committedKey).not.toBe(frame13.committedKey);
  });

  it('keeps all-frame clone strokes cached when the upstream stack is frame-static', () => {
    const paintNode: PaintNode = {
      id: 'paint_1',
      type: NodeType.PAINT,
      name: 'Paint',
      enabled: true,
      strokes: [
        {
          id: 'stroke_clone',
          name: 'Clone Stroke',
          tool: 'clone',
          visible: true,
          raster: 'asset_clone',
          pointCount: 2,
          size: 24,
          spacing: 20,
          softness: 50,
          opacity: 100,
          path: {
            mode: 'polyline',
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 10 },
            ],
          },
          cloneOffset: { x: 12, y: -8 },
        },
      ],
      layers: [],
      defaultLifetime: null,
    };
    const nodes: AnyNode[] = [
      {
        id: 'scene_1',
        type: NodeType.SCENE,
        name: 'Scene',
        enabled: true,
        width: 1920,
        height: 1080,
        bitDepth: 8,
        colorSpace: 'sRGB',
        maxFrames: 120,
        fps: 24,
      },
      {
        id: 'image_1',
        type: NodeType.MEDIA_SOURCE,
        name: 'Image',
        enabled: true,
        mediaKind: 'image',
        src: 'image_asset',
        width: 1920,
        height: 1080,
        opacity: 100,
        operator: BlendMode.OVER,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.FIT },
        colorSpace: 'sRGB',
      },
      paintNode,
    ];

    const frame12 = getPaintTextureCommittedState({
      node: paintNode,
      nodes,
      frame: 12,
      width: 1920,
      height: 1080,
    });
    const frame13 = getPaintTextureCommittedState({
      node: paintNode,
      nodes,
      frame: 13,
      width: 1920,
      height: 1080,
    });

    expect(frame12.requiresDynamicCloneSource).toBe(false);
    expect(frame13.requiresDynamicCloneSource).toBe(false);
    expect(frame12.committedKey).toBe(frame13.committedKey);
  });

  it('treats stored paint raster asset ids as persisted assets', () => {
    expect(isStoredPaintAssetId('asset_123')).toBe(true);
    expect(isStoredPaintAssetId('ref_456')).toBe(true);
    expect(isStoredPaintAssetId('data:image/png;base64,abc')).toBe(false);
  });

  it('uses straight-alpha destination-out for RGB erase rasters', () => {
    const target = { width: 1, height: 1, rgba: new Float32Array([-0.5, 2, 4, 1]) };
    const erase = { width: 1, height: 1, rgba: new Float32Array([1, 1, 1, 0.25]) };

    compositePaintRaster(target, erase, 'erase', 'rgb');

    expect(Array.from(target.rgba)).toEqual([-0.5, 2, 4, 0.75]);
  });

  it('composites negative and HDR RGB with straight-alpha source-over math', () => {
    const target = { width: 1, height: 1, rgba: new Float32Array([-0.5, 2, 4, 0.5]) };
    const source = { width: 1, height: 1, rgba: new Float32Array([1, -1, 8, 0.5]) };

    compositePaintRaster(target, source, 'brush', 'rgb');

    expect(target.rgba[0]).toBeCloseTo(0.5);
    expect(target.rgba[1]).toBeCloseTo(0);
    expect(target.rgba[2]).toBeCloseTo(20 / 3);
    expect(target.rgba[3]).toBeCloseTo(0.75);
  });

  it('applies live RGB erase directly without a full-frame intermediate raster', () => {
    const target = { width: 1, height: 1, rgba: new Float32Array([-0.5, 2, 4, 1]) };

    expect(
      applyPaintStrokeToRaster(target, {
        tool: 'erase',
        points: [{ x: 0, y: 0 }],
        width: 1,
        height: 1,
        size: 1,
        softness: 0,
        opacity: 50,
        color: [1, 1, 1],
        channels: 'rgb',
      }),
    ).toBe(true);
    expect(Array.from(target.rgba)).toEqual([-0.5, 2, 4, 0.5]);
  });

  it('rejects mismatched paint raster dimensions', () => {
    expect(() =>
      compositePaintRaster(createPaintRaster(1, 1), createPaintRaster(2, 1), 'brush', 'rgb'),
    ).toThrow('Paint rasters must have matching dimensions for compositing.');
  });

  it('keeps alpha-only erase target and coverage separate', () => {
    const target = createPaintRaster(1, 1);
    const erase = { width: 1, height: 1, rgba: new Float32Array([0, 0, 0, 0.25]) };

    compositePaintRaster(target, erase, 'erase', 'a');

    expect(Array.from(target.rgba)).toEqual([0, 0, 0, 0.25]);
  });

  it('clones negative and HDR RGB independently from source alpha', () => {
    const stroke = buildPaintStrokeRaster({
      tool: 'clone',
      points: [{ x: 0, y: 0 }],
      width: 1,
      height: 1,
      size: 1,
      spacing: 20,
      softness: 0,
      opacity: 100,
      color: [0, 0, 0],
      cloneOffset: { x: 0, y: 0 },
      cloneSource: {
        rgb: { width: 1, height: 1, rgba: new Float32Array([-0.5, 2, 4, 1]) },
        alpha: { width: 1, height: 1, rgba: new Float32Array([0, 0, 0, 1]) },
      },
    });

    expect(Array.from(stroke?.rgba ?? [])).toEqual([-0.5, 2, 4, 1]);
  });
});
