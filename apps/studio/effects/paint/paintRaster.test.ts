import { describe, expect, it } from 'vitest';
import { BlendMode, ImageFitMode, NodeType, type AnyNode, type PaintNode } from '@blackboard/types';
import {
  compositePaintRasterOntoCanvas,
  createPaintStrokePath,
  getPaintTextureCacheKey,
  isStoredPaintAssetId,
  paintNodeHasFrameBoundCloneLifetime,
  paintNodeUsesDynamicCloneSourceAtFrame,
} from './paintRaster';
import { getPaintTextureCommittedState } from './paintTextureKeys';

const createMockCanvasContext = () => {
  const drawCompositeOperations: string[] = [];
  let compositeOperation: GlobalCompositeOperation = 'source-over';

  const ctx = {
    createRadialGradient: () => ({
      addColorStop: () => undefined,
    }),
    beginPath: () => undefined,
    arc: () => undefined,
    fill: () => undefined,
    drawImage: () => {
      drawCompositeOperations.push(compositeOperation);
    },
    clearRect: () => undefined,
    set fillStyle(_value: string | CanvasGradient | CanvasPattern) {},
    get fillStyle() {
      return '';
    },
    set globalCompositeOperation(value: GlobalCompositeOperation) {
      compositeOperation = value;
    },
    get globalCompositeOperation() {
      return compositeOperation;
    },
  } as unknown as CanvasRenderingContext2D;

  const canvas = {
    width: 128,
    height: 128,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;

  return { canvas, drawCompositeOperations, ctx };
};

describe('paint raster helpers', () => {
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
      visible: true,
      strokes: [
        {
          id: 'stroke_clone',
          name: 'Clone Stroke',
          tool: 'clone',
          visible: true,
          raster: 'asset_clone',
          pointCount: 2,
          size: 24,
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
        visible: true,
        width: 1920,
        height: 1080,
        bitDepth: 8,
        colorSpace: 'sRGB',
        maxFrames: 120,
        fps: 24,
      },
      {
        id: 'video_1',
        type: NodeType.VIDEO,
        name: 'Video',
        visible: true,
        src: 'video_asset',
        width: 1920,
        height: 1080,
        opacity: 100,
        operator: BlendMode.OVER,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: ImageFitMode.FIT },
        duration: 120,
        loop: true,
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
      visible: true,
      strokes: [
        {
          id: 'stroke_clone',
          name: 'Clone Stroke',
          tool: 'clone',
          visible: true,
          raster: 'asset_clone',
          pointCount: 2,
          size: 24,
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
        visible: true,
        width: 1920,
        height: 1080,
        bitDepth: 8,
        colorSpace: 'sRGB',
        maxFrames: 120,
        fps: 24,
      },
      {
        id: 'image_1',
        type: NodeType.IMAGE,
        name: 'Image',
        visible: true,
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

  it('uses destination-out when compositing erase rasters', () => {
    const { canvas, drawCompositeOperations, ctx } = createMockCanvasContext();

    expect(compositePaintRasterOntoCanvas(canvas, {} as CanvasImageSource, 'erase')).toBe(true);

    expect(drawCompositeOperations).toEqual(['destination-out']);
    expect(ctx.globalCompositeOperation).toBe('source-over');
  });

  it('uses destination-out when compositing alpha-only erase rasters', () => {
    const { canvas, drawCompositeOperations, ctx } = createMockCanvasContext();

    expect(compositePaintRasterOntoCanvas(canvas, {} as CanvasImageSource, 'erase', 'a')).toBe(
      true,
    );

    expect(drawCompositeOperations).toEqual(['destination-out']);
    expect(ctx.globalCompositeOperation).toBe('source-over');
  });
});
