import type {
  PaintLayer,
  PaintNode,
  PaintStroke,
  PaintStrokeChannels,
  PaintStrokePath,
  PaintLifetime,
  PaintTool,
  PaintViewportTool,
  Point,
} from '@blackboard/types';
import { getCloneSourceFromOffset } from './cloneMath';
import {
  buildPaintHierarchy,
  flattenPaintHierarchyStrokeItems,
  getPaintLayerMap,
} from './paintLayers';
import { resolvePaintSoftness } from './softness';
import { simplifyPath } from '@/utils/bspline';
import {
  resolveCanvasStorageColorType,
  type CanvasStorageColorType,
} from '@/utils/canvasColorType';
import { getAsset, saveAsset } from '@/state/assetStorage';

const imageCache = new Map<string, Promise<CanvasImageSource>>();
const runtimePaintRasterCache = new Map<string, HTMLCanvasElement>();
const PAINT_ASSET_PREFIXES = ['asset_', 'ref_'] as const;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
const clampUnit = (value: number): number => clamp(value, 0, 1);
const ERASE_MASK_COLOR: [number, number, number] = [1, 1, 1];
const ALPHA_ERASE_COLOR: [number, number, number] = [0, 0, 0];

const resolvePaintStrokeChannels = (channels?: PaintStrokeChannels | null): PaintStrokeChannels =>
  channels ?? 'rgb';

const isAlphaOnlyPaintStroke = (channels?: PaintStrokeChannels | null): boolean =>
  resolvePaintStrokeChannels(channels) === 'a';

const getAlphaPaintColor = (alpha: number): [number, number, number] => {
  const value = clampUnit(alpha);
  return [value, value, value];
};

const sceneToCanvasPoint = (
  point: Point,
  width: number,
  height: number,
): { x: number; y: number } => ({
  x: point.x + width / 2,
  y: point.y + height / 2,
});

type CanvasRenderingContext2DWithColorType = CanvasRenderingContext2D & {
  getContextAttributes?: () => (CanvasRenderingContext2DSettings & { colorType?: unknown }) | null;
};

const getPaintCanvasContext = (
  canvas: HTMLCanvasElement,
  requestedColorType: CanvasStorageColorType = 'unorm8',
): { ctx: CanvasRenderingContext2D; actualColorType: CanvasStorageColorType } | null => {
  const requestedOptions =
    requestedColorType === 'float16'
      ? ({ colorType: 'float16' } as unknown as CanvasRenderingContext2DSettings)
      : undefined;
  const ctx = requestedOptions
    ? ((canvas.getContext('2d', requestedOptions) as CanvasRenderingContext2D | null) ??
      canvas.getContext('2d'))
    : canvas.getContext('2d');
  if (!ctx) return null;

  const ctxWithColorType = ctx as CanvasRenderingContext2DWithColorType;
  const attributes =
    typeof ctxWithColorType.getContextAttributes === 'function'
      ? ctxWithColorType.getContextAttributes()
      : null;

  return {
    ctx,
    actualColorType: resolveCanvasStorageColorType(
      attributes as ({ colorType?: unknown } & CanvasRenderingContext2DSettings) | null,
    ),
  };
};

const getPaintCanvasColorType = (
  canvas: HTMLCanvasElement | null | undefined,
): CanvasStorageColorType => {
  if (!canvas) {
    return 'unorm8';
  }

  return getPaintCanvasContext(canvas)?.actualColorType ?? 'unorm8';
};

export const createPaintCanvas = (
  width: number,
  height: number,
  requestedColorType: CanvasStorageColorType = 'unorm8',
): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  getPaintCanvasContext(canvas, requestedColorType);
  return canvas;
};

export const isStoredPaintAssetId = (value: string): boolean =>
  PAINT_ASSET_PREFIXES.some((prefix) => value.startsWith(prefix));

const hashPaintCacheKeyPart = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
};

const isFrameBoundPaintLifetime = (lifetime?: PaintLifetime | null): boolean =>
  Boolean(lifetime && lifetime.mode !== 'all');

const getPaintLifetimeCacheKey = (lifetime?: PaintLifetime | null): string => {
  if (!lifetime || lifetime.mode === 'all') {
    return 'all';
  }

  if (lifetime.mode === 'single') {
    return `single:${Math.round(lifetime.frame)}`;
  }

  return `range:${Math.round(lifetime.startFrame)}-${Math.round(lifetime.endFrame)}`;
};

export const paintNodeHasFrameBoundVisibility = (
  node: Pick<PaintNode, 'strokes' | 'layers'>,
): boolean =>
  node.strokes.some((stroke) => isFrameBoundPaintLifetime(stroke.lifetime)) ||
  (node.layers ?? []).some((layer) => isFrameBoundPaintLifetime(layer.lifetime));

const hasFrameBoundPaintLayerLifetime = (
  layerId: string | null | undefined,
  layerMap: Map<string, PaintLayer>,
): boolean => {
  let currentLayerId = layerId ?? null;
  const visited = new Set<string>();

  while (currentLayerId && !visited.has(currentLayerId)) {
    visited.add(currentLayerId);
    const layer = layerMap.get(currentLayerId);
    if (!layer) {
      return false;
    }
    if (isFrameBoundPaintLifetime(layer.lifetime)) {
      return true;
    }
    currentLayerId = layer.parentLayerId ?? null;
  }

  return false;
};

export const paintStrokeUsesDynamicCloneSource = (
  node: Pick<PaintNode, 'layers'>,
  stroke: Pick<PaintStroke, 'id' | 'tool' | 'cloneOffset' | 'path' | 'lifetime' | 'parentLayerId'>,
  prebuiltLayerMap?: Map<string, PaintLayer>,
): boolean => {
  if (stroke.tool !== 'clone' || !stroke.cloneOffset || !stroke.path?.points.length) {
    return false;
  }

  if (isFrameBoundPaintLifetime(stroke.lifetime)) {
    return true;
  }

  const layerMap = prebuiltLayerMap ?? getPaintLayerMap(node);
  const parentLayerId =
    stroke.parentLayerId && layerMap.has(stroke.parentLayerId) ? stroke.parentLayerId : null;
  return hasFrameBoundPaintLayerLifetime(parentLayerId, layerMap);
};

export const paintNodeHasFrameBoundCloneLifetime = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
): boolean => {
  const layerMap = getPaintLayerMap(node);
  return node.strokes.some((stroke) => paintStrokeUsesDynamicCloneSource(node, stroke, layerMap));
};

export const paintNodeHasVisibleContentAtFrame = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  frame: number,
): boolean => {
  const layerMap = getPaintLayerMap(node);
  return flattenPaintHierarchyStrokeItems(buildPaintHierarchy(node, frame)).some(
    (item) =>
      item.visible &&
      item.activeAtFrame &&
      (Boolean(item.stroke.raster) ||
        paintStrokeUsesDynamicCloneSource(node, item.stroke, layerMap)),
  );
};

export const paintNodeUsesCloneSourceAtFrame = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  frame: number,
): boolean =>
  flattenPaintHierarchyStrokeItems(buildPaintHierarchy(node, frame)).some(
    (item) =>
      item.visible &&
      item.activeAtFrame &&
      item.stroke.tool === 'clone' &&
      Boolean(item.stroke.cloneOffset) &&
      Boolean(item.stroke.path?.points.length),
  );

export const paintNodeUsesDynamicCloneSourceAtFrame = (
  node: Pick<PaintNode, 'layers' | 'strokes'>,
  frame: number,
): boolean => {
  const layerMap = getPaintLayerMap(node);
  return flattenPaintHierarchyStrokeItems(buildPaintHierarchy(node, frame)).some(
    (item) =>
      item.visible &&
      item.activeAtFrame &&
      paintStrokeUsesDynamicCloneSource(node, item.stroke, layerMap),
  );
};

interface PaintTextureCacheKeyOptions {
  forceFrame?: boolean;
}

export const getPaintTextureCacheKey = (
  node: Pick<PaintNode, 'strokes' | 'layers'>,
  frame: number,
  width: number,
  height: number,
  options: PaintTextureCacheKeyOptions = {},
): string => {
  const strokeCount = node.strokes.length;
  const firstId = strokeCount > 0 ? node.strokes[0].id : 'empty';
  const lastId = strokeCount > 1 ? node.strokes[strokeCount - 1].id : firstId;

  const visibilityKey = node.strokes.reduce(
    (hash, stroke) => (hash * 31 + (stroke.visible ? 1 : 0)) | 0,
    0,
  );

  const layerCount = node.layers?.length ?? 0;
  const layerKey =
    layerCount > 0
      ? hashPaintCacheKeyPart(
          (node.layers ?? [])
            .map(
              (layer) =>
                `${layer.id}:${layer.visible === false ? '0' : '1'}:${getPaintLifetimeCacheKey(layer.lifetime)}`,
            )
            .join('|'),
        )
      : '0';
  const frameKey =
    options.forceFrame || paintNodeHasFrameBoundVisibility(node) ? Math.round(frame) : 'static';

  return `${width}x${height}:${frameKey}:${strokeCount}:${firstId}:${lastId}:${visibilityKey}:${layerKey}`;
};

const getStrokeColor = (color: [number, number, number], alpha: number): string =>
  `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${alpha})`;

const createBrushMask = (
  diameter: number,
  softness: number,
  opacity: number,
  canvasColorType: CanvasStorageColorType = 'unorm8',
): HTMLCanvasElement => {
  const canvas = createPaintCanvas(diameter, diameter, canvasColorType);
  const context = getPaintCanvasContext(canvas, canvasColorType);
  if (!context) return canvas;
  const { ctx } = context;

  const radius = diameter / 2;
  const innerStop = clamp(1 - softness / 100, 0, 1);
  const gradient = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  gradient.addColorStop(0, `rgba(255, 255, 255, ${opacity / 100})`);
  gradient.addColorStop(innerStop, `rgba(255, 255, 255, ${opacity / 100})`);
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(radius, radius, radius, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
};

export interface StampResult {
  stamps: Point[];
  remainder: number;
}

const collectStampPoints = (points: Point[], spacing: number): Point[] => {
  if (points.length <= 1) return [...points];

  const stamps: Point[] = [points[0]];
  let remaining = spacing;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.hypot(dx, dy);

    if (distance === 0) {
      continue;
    }

    let travelled = 0;
    while (travelled + remaining <= distance) {
      travelled += remaining;
      const t = travelled / distance;
      stamps.push({
        x: start.x + dx * t,
        y: start.y + dy * t,
      });
      remaining = spacing;
    }

    remaining -= distance - travelled;
  }

  const lastPoint = points[points.length - 1];
  const lastStamp = stamps[stamps.length - 1];
  if (!lastStamp || lastStamp.x !== lastPoint.x || lastStamp.y !== lastPoint.y) {
    stamps.push(lastPoint);
  }

  return stamps;
};

export const loadPaintRasterImage = (src: string): Promise<CanvasImageSource> => {
  if (!src) {
    return Promise.reject(new Error('Missing paint raster source.'));
  }

  const runtimeRaster = runtimePaintRasterCache.get(src);
  if (runtimeRaster) {
    return Promise.resolve(runtimeRaster);
  }

  const cached = imageCache.get(src);
  if (cached) return cached;

  const promise = (async () => {
    const image = new Image();
    image.onerror = () => {
      imageCache.delete(src);
    };

    const imageSrc = isStoredPaintAssetId(src)
      ? await (async () => {
          const blob = await getAsset(src);
          if (!blob) {
            throw new Error('Missing paint raster asset.');
          }
          return URL.createObjectURL(blob);
        })()
      : src;

    return await new Promise<HTMLImageElement>((resolve, reject) => {
      image.onload = () => {
        if (imageSrc !== src) {
          URL.revokeObjectURL(imageSrc);
        }
        resolve(image);
      };
      image.onerror = () => {
        imageCache.delete(src);
        if (imageSrc !== src) {
          URL.revokeObjectURL(imageSrc);
        }
        reject(new Error('Failed to load paint raster image.'));
      };
      image.src = imageSrc;
    });
  })();

  imageCache.set(src, promise);
  return promise;
};

export const cloneCanvas = (
  source: HTMLCanvasElement,
  requestedColorType: CanvasStorageColorType = getPaintCanvasColorType(source),
): HTMLCanvasElement => {
  const canvas = createPaintCanvas(source.width, source.height, requestedColorType);
  const context = getPaintCanvasContext(canvas, requestedColorType);
  if (context) {
    context.ctx.drawImage(source, 0, 0);
  }
  return canvas;
};

export const canvasToDataUrlAsync = async (
  canvas: HTMLCanvasElement,
  type = 'image/png',
  quality?: number,
): Promise<string> => {
  if (typeof canvas.toBlob !== 'function' || typeof FileReader === 'undefined') {
    return canvas.toDataURL(type, quality);
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((nextBlob) => resolve(nextBlob), type, quality);
  });

  if (!blob) {
    return canvas.toDataURL(type, quality);
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read canvas blob as data URL.'));
    reader.onloadend = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Unexpected FileReader result for canvas blob.'));
    reader.readAsDataURL(blob);
  });
};

export const canvasToBlobAsync = async (
  canvas: HTMLCanvasElement,
  type = 'image/png',
  quality?: number,
): Promise<Blob> => {
  if (typeof canvas.toBlob !== 'function') {
    const response = await fetch(canvas.toDataURL(type, quality));
    return response.blob();
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((nextBlob) => resolve(nextBlob), type, quality);
  });

  if (!blob) {
    const response = await fetch(canvas.toDataURL(type, quality));
    return response.blob();
  }

  return blob;
};

export const savePaintStrokeCanvas = async (canvas: HTMLCanvasElement): Promise<string> => {
  const raster = await saveAsset(await canvasToBlobAsync(canvas));
  if (raster) {
    runtimePaintRasterCache.set(raster, cloneCanvas(canvas));
  }
  return raster;
};

export const clearPaintCanvas = (canvas: HTMLCanvasElement): HTMLCanvasElement => {
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  return canvas;
};

export const resizeOrClearPaintCanvas = (
  canvas: HTMLCanvasElement | null | undefined,
  width: number,
  height: number,
  requestedColorType: CanvasStorageColorType = canvas ? getPaintCanvasColorType(canvas) : 'unorm8',
): HTMLCanvasElement => {
  if (
    !canvas ||
    canvas.width !== width ||
    canvas.height !== height ||
    getPaintCanvasColorType(canvas) !== requestedColorType
  ) {
    return createPaintCanvas(width, height, requestedColorType);
  }

  return clearPaintCanvas(canvas);
};

const drawBrushStampsToContext = (
  ctx: CanvasRenderingContext2D,
  stamps: Point[],
  width: number,
  height: number,
  color: [number, number, number],
  size: number,
  softness: number,
  opacity: number,
) => {
  const radius = Math.max(0.5, size / 2);
  const innerStop = clamp(1 - softness / 100, 0, 1);
  const colorFill = getStrokeColor(color, opacity / 100);
  const colorEdge = getStrokeColor(color, 0);

  for (let i = 0; i < stamps.length; i += 1) {
    const point = sceneToCanvasPoint(stamps[i], width, height);
    const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    gradient.addColorStop(0, colorFill);
    gradient.addColorStop(innerStop, colorFill);
    gradient.addColorStop(1, colorEdge);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
};

const drawBrushStroke = (
  ctx: CanvasRenderingContext2D,
  points: Point[],
  width: number,
  height: number,
  color: [number, number, number],
  size: number,
  softness: number,
  opacity: number,
) => {
  const radius = Math.max(0.5, size / 2);
  const stamps = collectStampPoints(points, Math.max(1, radius * 0.35));
  drawBrushStampsToContext(ctx, stamps, width, height, color, size, softness, opacity);
};

const drawCloneStampsToContext = (
  ctx: CanvasRenderingContext2D,
  stamps: Point[],
  width: number,
  height: number,
  size: number,
  cloneOffset: Point,
  sourceCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  canvasColorType: CanvasStorageColorType,
  alphaOnly = false,
) => {
  if (stamps.length === 0) return;

  const radius = Math.max(0.5, size / 2);
  const diameter = Math.max(1, Math.ceil(radius * 2));
  const stampCanvas = createPaintCanvas(diameter, diameter, canvasColorType);
  const stampContext = getPaintCanvasContext(stampCanvas, canvasColorType);
  if (!stampContext) return;
  const { ctx: stampCtx } = stampContext;
  const maskCtx = alphaOnly ? maskCanvas.getContext('2d') : null;
  const maskImageData =
    alphaOnly && maskCtx ? maskCtx.getImageData(0, 0, diameter, diameter).data : null;

  for (let i = 0; i < stamps.length; i += 1) {
    const destinationPoint = sceneToCanvasPoint(stamps[i], width, height);
    const sourcePoint = getCloneSourceFromOffset(stamps[i], cloneOffset);
    if (!sourcePoint) continue;

    const samplePoint = sceneToCanvasPoint(sourcePoint, width, height);
    stampCtx.clearRect(0, 0, diameter, diameter);
    stampCtx.globalCompositeOperation = 'source-over';
    stampCtx.drawImage(
      sourceCanvas,
      samplePoint.x - radius,
      samplePoint.y - radius,
      diameter,
      diameter,
      0,
      0,
      diameter,
      diameter,
    );

    if (alphaOnly && maskImageData) {
      const sampledAlphaImage = stampCtx.getImageData(0, 0, diameter, diameter);
      const { data } = sampledAlphaImage;
      for (let offset = 0; offset < data.length; offset += 4) {
        const sourceAlpha = data[offset + 3];
        const maskAlpha = maskImageData[offset + 3];
        data[offset] = sourceAlpha;
        data[offset + 1] = sourceAlpha;
        data[offset + 2] = sourceAlpha;
        data[offset + 3] = maskAlpha;
      }
      stampCtx.clearRect(0, 0, diameter, diameter);
      stampCtx.putImageData(sampledAlphaImage, 0, 0);
    } else {
      stampCtx.globalCompositeOperation = 'destination-in';
      stampCtx.drawImage(maskCanvas, 0, 0);
      stampCtx.globalCompositeOperation = 'source-over';
    }

    ctx.drawImage(stampCanvas, destinationPoint.x - radius, destinationPoint.y - radius);
  }
};

const drawCloneStroke = (
  ctx: CanvasRenderingContext2D,
  points: Point[],
  width: number,
  height: number,
  size: number,
  softness: number,
  opacity: number,
  cloneOffset: Point,
  sourceCanvas: HTMLCanvasElement,
  canvasColorType: CanvasStorageColorType,
  alphaOnly = false,
) => {
  if (points.length === 0) return;

  const radius = Math.max(0.5, size / 2);
  const diameter = Math.max(1, Math.ceil(radius * 2));
  const maskCanvas = createBrushMask(diameter, softness, opacity, canvasColorType);
  const stamps = collectStampPoints(points, Math.max(1, radius * 0.35));
  drawCloneStampsToContext(
    ctx,
    stamps,
    width,
    height,
    size,
    cloneOffset,
    sourceCanvas,
    maskCanvas,
    canvasColorType,
    alphaOnly,
  );
};

export interface PaintStrokeRasterParams {
  tool: PaintTool;
  points: Point[];
  width: number;
  height: number;
  size: number;
  softness?: number;
  opacity: number;
  color: [number, number, number];
  alpha?: number;
  channels?: PaintStrokeChannels;
  cloneOffset?: Point | null;
  sourceCanvas?: HTMLCanvasElement | null;
  canvasColorType?: CanvasStorageColorType;
}

interface PaintCompositeBuildOptions {
  resolveCloneSourceCanvas?: (() => Promise<HTMLCanvasElement | null>) | null;
}

export interface PaintLivePreview {
  nodeId: string;
  cacheKey: string;
  cursor: number;
  tool: PaintTool;
  points: Point[];
  size: number;
  softness: number;
  opacity: number;
  color: [number, number, number];
  alpha: number;
  channels: PaintStrokeChannels;
  cloneOffset?: Point | null;
  sourceCanvas?: HTMLCanvasElement | null;
  canvasColorType?: CanvasStorageColorType;
}

const drawIsolatedPaintStrokeToContext = (
  ctx: CanvasRenderingContext2D,
  params: PaintStrokeRasterParams,
) => {
  if (params.points.length === 0) return;

  const resolvedSoftness = resolvePaintSoftness({
    softness: params.softness,
  });
  const previousCompositeOperation = ctx.globalCompositeOperation;
  const affectAlphaOnly = isAlphaOnlyPaintStroke(params.channels);

  if (params.tool === 'brush') {
    ctx.globalCompositeOperation = 'source-over';
    drawBrushStroke(
      ctx,
      params.points,
      params.width,
      params.height,
      affectAlphaOnly ? getAlphaPaintColor(params.alpha ?? 1) : params.color,
      params.size,
      resolvedSoftness,
      params.opacity,
    );
  } else if (params.tool === 'erase') {
    // RGB erase strokes are applied with destination-out during compositing.
    // Alpha erase strokes encode a target alpha of 0 with normal source-over blending.
    ctx.globalCompositeOperation = 'source-over';
    drawBrushStroke(
      ctx,
      params.points,
      params.width,
      params.height,
      affectAlphaOnly ? ALPHA_ERASE_COLOR : ERASE_MASK_COLOR,
      params.size,
      resolvedSoftness,
      params.opacity,
    );
  } else if (params.tool === 'clone' && params.sourceCanvas && params.cloneOffset) {
    ctx.globalCompositeOperation = 'source-over';
    drawCloneStroke(
      ctx,
      params.points,
      params.width,
      params.height,
      params.size,
      resolvedSoftness,
      params.opacity,
      params.cloneOffset,
      params.sourceCanvas,
      params.canvasColorType ?? getPaintCanvasColorType(params.sourceCanvas),
      affectAlphaOnly,
    );
  }

  ctx.globalCompositeOperation = previousCompositeOperation;
};

const compositePaintRasterToContext = (
  ctx: CanvasRenderingContext2D,
  raster: CanvasImageSource,
  tool: PaintTool,
  width: number,
  height: number,
) => {
  const previousCompositeOperation = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
  ctx.drawImage(raster, 0, 0, width, height);
  ctx.globalCompositeOperation = previousCompositeOperation;
};

export const buildPaintStrokeCanvas = (
  params: PaintStrokeRasterParams,
): HTMLCanvasElement | null => {
  const canvasColorType =
    params.canvasColorType ?? getPaintCanvasColorType(params.sourceCanvas) ?? 'unorm8';
  const canvas = createPaintCanvas(params.width, params.height, canvasColorType);
  const context = getPaintCanvasContext(canvas, canvasColorType);
  if (!context || params.points.length === 0) return null;

  drawIsolatedPaintStrokeToContext(context.ctx, params);
  return canvas;
};

export const compositePaintRasterOntoCanvas = (
  canvas: HTMLCanvasElement,
  raster: CanvasImageSource,
  tool: PaintTool,
  channels?: PaintStrokeChannels,
): boolean => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  compositePaintRasterToContext(ctx, raster, tool, canvas.width, canvas.height);
  return true;
};

const getPaintStrokePathEpsilon = (size: number): number => Math.max(0.5, size * 0.04);

export const createPaintStrokePath = (points: Point[], size: number): PaintStrokePath | null => {
  if (points.length === 0) return null;

  const simplifiedPoints =
    points.length > 2 ? simplifyPath(points, getPaintStrokePathEpsilon(size)) : points;

  return {
    mode: simplifiedPoints.length >= 4 ? 'bspline' : 'polyline',
    points: simplifiedPoints,
  };
};

export const rasterizePaintStroke = ({
  tool,
  points,
  width,
  height,
  size,
  softness,
  opacity,
  color,
  alpha,
  channels,
  cloneOffset,
  sourceCanvas,
  canvasColorType,
}: PaintStrokeRasterParams): string => {
  const canvas = buildPaintStrokeCanvas({
    tool,
    points,
    width,
    height,
    size,
    softness,
    opacity,
    color,
    alpha,
    channels,
    cloneOffset,
    sourceCanvas,
    canvasColorType,
  });
  if (!canvas) return '';

  return canvas.toDataURL('image/png');
};

export const buildPaintCompositeCanvas = async (
  strokes: PaintStroke[],
  width: number,
  height: number,
  layers?: PaintLayer[],
  frame?: number,
  canvasColorType: CanvasStorageColorType = 'unorm8',
  options: PaintCompositeBuildOptions = {},
): Promise<HTMLCanvasElement | null> => {
  const paintNode = { layers, strokes };
  const visibleStrokes = flattenPaintHierarchyStrokeItems(buildPaintHierarchy(paintNode, frame))
    .filter(
      (item) =>
        item.visible &&
        item.activeAtFrame &&
        item.stroke.raster &&
        !isAlphaOnlyPaintStroke(item.stroke.channels),
    )
    .map((item) => item.stroke);

  if (visibleStrokes.length === 0) return null;

  const canvas = createPaintCanvas(width, height, canvasColorType);
  const context = getPaintCanvasContext(canvas, canvasColorType);
  if (!context) return null;
  const { ctx } = context;
  let cloneSourceCanvasPromise: Promise<HTMLCanvasElement | null> | null = null;

  const getCloneSourceCanvas = async (): Promise<HTMLCanvasElement | null> => {
    if (!options.resolveCloneSourceCanvas) {
      return null;
    }

    cloneSourceCanvasPromise ??= options.resolveCloneSourceCanvas();
    return cloneSourceCanvasPromise;
  };

  for (const stroke of [...visibleStrokes].reverse()) {
    let image: CanvasImageSource | null = null;

    if (stroke.tool === 'clone' && stroke.path?.points.length && stroke.cloneOffset) {
      const cloneSourceCanvas = await getCloneSourceCanvas();
      if (cloneSourceCanvas) {
        image = buildPaintStrokeCanvas({
          tool: stroke.tool,
          points: stroke.path.points,
          width,
          height,
          size: stroke.size,
          softness: stroke.softness,
          opacity: stroke.opacity,
          color: stroke.color ?? [1, 1, 1],
          alpha: stroke.alpha,
          channels: stroke.channels,
          cloneOffset: stroke.cloneOffset,
          sourceCanvas: cloneSourceCanvas,
          canvasColorType,
        });
      }
    }

    if (!image && stroke.raster) {
      image = await loadPaintRasterImage(stroke.raster);
    }

    if (!image) {
      continue;
    }

    compositePaintRasterToContext(ctx, image, stroke.tool, width, height);
  }

  ctx.globalCompositeOperation = 'source-over';
  return canvas;
};

export const buildPaintAlphaCompositeCanvas = async (
  strokes: PaintStroke[],
  width: number,
  height: number,
  layers?: PaintLayer[],
  frame?: number,
  canvasColorType: CanvasStorageColorType = 'unorm8',
  options: PaintCompositeBuildOptions = {},
): Promise<HTMLCanvasElement | null> => {
  const paintNode = { layers, strokes };
  const visibleStrokes = flattenPaintHierarchyStrokeItems(buildPaintHierarchy(paintNode, frame))
    .filter(
      (item) =>
        item.visible &&
        item.activeAtFrame &&
        item.stroke.raster &&
        isAlphaOnlyPaintStroke(item.stroke.channels),
    )
    .map((item) => item.stroke);

  if (visibleStrokes.length === 0) return null;

  const canvas = createPaintCanvas(width, height, canvasColorType);
  const context = getPaintCanvasContext(canvas, canvasColorType);
  if (!context) return null;
  const { ctx } = context;
  let cloneSourceCanvasPromise: Promise<HTMLCanvasElement | null> | null = null;

  const getCloneSourceCanvas = async (): Promise<HTMLCanvasElement | null> => {
    if (!options.resolveCloneSourceCanvas) {
      return null;
    }

    cloneSourceCanvasPromise ??= options.resolveCloneSourceCanvas();
    return cloneSourceCanvasPromise;
  };

  for (const stroke of [...visibleStrokes].reverse()) {
    let image: CanvasImageSource | null = null;

    if (stroke.tool === 'clone' && stroke.path?.points.length && stroke.cloneOffset) {
      const cloneSourceCanvas = await getCloneSourceCanvas();
      if (cloneSourceCanvas) {
        image = buildPaintStrokeCanvas({
          tool: stroke.tool,
          points: stroke.path.points,
          width,
          height,
          size: stroke.size,
          softness: stroke.softness,
          opacity: stroke.opacity,
          color: stroke.color ?? [1, 1, 1],
          alpha: stroke.alpha,
          channels: stroke.channels,
          cloneOffset: stroke.cloneOffset,
          sourceCanvas: cloneSourceCanvas,
          canvasColorType,
        });
      }
    }

    if (!image && stroke.raster) {
      image = await loadPaintRasterImage(stroke.raster);
    }

    if (!image) {
      continue;
    }

    compositePaintRasterToContext(ctx, image, stroke.tool, width, height);
  }

  ctx.globalCompositeOperation = 'source-over';
  return canvas;
};

export const buildPaintCompositeDataUrl = async (
  strokes: PaintStroke[],
  width: number,
  height: number,
  layers?: PaintLayer[],
  frame?: number,
  canvasColorType: CanvasStorageColorType = 'unorm8',
  options: PaintCompositeBuildOptions = {},
): Promise<string> => {
  const canvas = await buildPaintCompositeCanvas(
    strokes,
    width,
    height,
    layers,
    frame,
    canvasColorType,
    options,
  );
  return canvas ? canvasToDataUrlAsync(canvas) : '';
};

export const buildPaintAlphaCompositeDataUrl = async (
  strokes: PaintStroke[],
  width: number,
  height: number,
  layers?: PaintLayer[],
  frame?: number,
  canvasColorType: CanvasStorageColorType = 'unorm8',
  options: PaintCompositeBuildOptions = {},
): Promise<string> => {
  const canvas = await buildPaintAlphaCompositeCanvas(
    strokes,
    width,
    height,
    layers,
    frame,
    canvasColorType,
    options,
  );
  return canvas ? canvasToDataUrlAsync(canvas) : '';
};

export const getNextPaintStrokeName = (strokes: PaintStroke[], tool: PaintTool): string => {
  const displayName = tool === 'brush' ? 'Brush' : tool === 'erase' ? 'Erase' : 'Clone';
  const nextIndex =
    strokes.reduce((count, stroke) => count + (stroke.tool === tool ? 1 : 0), 0) + 1;
  return `${displayName} ${nextIndex}`;
};

export const isPaintTool = (value: string | null): value is PaintTool =>
  value === 'brush' || value === 'erase' || value === 'clone';

export const isPaintViewportTool = (value: string | null): value is PaintViewportTool =>
  value === 'brush' ||
  value === 'erase' ||
  value === 'clone' ||
  value === 'select' ||
  value === 'nudge';
