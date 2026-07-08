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
  destinationOutStraightAlphaPixel,
  sourceOverStraightAlphaPixel,
} from '@blackboard/renderer';
import { getAsset, saveAsset } from '@/state/assetStorage';
import { decodeExrImage } from '@/utils/exr';
import { encodeOpenExr } from '@/utils/exrExport';
import type { PaintCloneSource, PaintRaster } from './paintFloatReadback';

const imageCache = new Map<string, Promise<PaintRaster>>();
const runtimePaintRasterCache = new Map<string, PaintRaster>();
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

const sceneToRasterPoint = (
  point: Point,
  width: number,
  height: number,
): { x: number; y: number } => ({
  x: point.x + width / 2,
  y: point.y + height / 2,
});

export const createPaintRaster = (width: number, height: number): PaintRaster => ({
  width,
  height,
  rgba: new Float32Array(width * height * 4),
});

export const clonePaintRaster = (source: PaintRaster): PaintRaster => ({
  width: source.width,
  height: source.height,
  rgba: source.rgba.slice(),
});

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

export const collectPaintStampPoints = (points: Point[], spacing: number): Point[] => {
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

export const loadPaintRaster = (src: string): Promise<PaintRaster> => {
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
    if (!isStoredPaintAssetId(src)) {
      throw new Error('Paint strokes require stored floating-point raster assets.');
    }
    const blob = await getAsset(src);
    if (!blob) {
      throw new Error('Missing paint raster asset.');
    }
    const decoded = await decodeExrImage(blob, { cacheKey: `paint:${src}` });
    return {
      width: decoded.width,
      height: decoded.height,
      rgba: decoded.rgba,
    };
  })();

  imageCache.set(src, promise);
  return promise;
};

export const savePaintStrokeRaster = async (source: PaintRaster): Promise<string> => {
  const raster = await saveAsset(
    await encodeOpenExr(
      {
        width: source.width,
        height: source.height,
        rgba: source.rgba,
      },
      {
        precision: 'half',
        includeAlpha: true,
      },
    ),
  );
  if (raster) {
    runtimePaintRasterCache.set(raster, clonePaintRaster(source));
  }
  return raster;
};

const getBrushCoverage = (
  distance: number,
  radius: number,
  softness: number,
  opacity: number,
): number => {
  if (distance > radius) return 0;
  const innerRadius = radius * clamp(1 - softness / 100, 0, 1);
  if (distance <= innerRadius || innerRadius === radius) {
    return clampUnit(opacity / 100);
  }
  return (
    clampUnit(opacity / 100) * clampUnit(1 - (distance - innerRadius) / (radius - innerRadius))
  );
};

const forEachStampPixel = (
  raster: PaintRaster,
  center: { x: number; y: number },
  radius: number,
  callback: (x: number, y: number, offset: number, distance: number) => void,
) => {
  const minX = Math.max(0, Math.floor(center.x - radius));
  const maxX = Math.min(raster.width - 1, Math.ceil(center.x + radius) - 1);
  const minY = Math.max(0, Math.floor(center.y - radius));
  const maxY = Math.min(raster.height - 1, Math.ceil(center.y + radius) - 1);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = Math.hypot(x + 0.5 - center.x, y + 0.5 - center.y);
      if (distance <= radius) {
        callback(x, y, (y * raster.width + x) * 4, distance);
      }
    }
  }
};

const drawBrushStroke = (
  raster: PaintRaster,
  points: Point[],
  color: [number, number, number],
  size: number,
  spacing: number,
  softness: number,
  opacity: number,
  operation: 'source-over' | 'destination-out' = 'source-over',
) => {
  const radius = Math.max(0.5, size / 2);
  const stamps = collectPaintStampPoints(points, Math.max(0.5, size * (spacing / 100)));

  for (const stamp of stamps) {
    const center = sceneToRasterPoint(stamp, raster.width, raster.height);
    forEachStampPixel(raster, center, radius, (_x, _y, offset, distance) => {
      const coverage = getBrushCoverage(distance, radius, softness, opacity);
      if (operation === 'destination-out') {
        destinationOutStraightAlphaPixel(raster.rgba, offset, coverage);
      } else {
        sourceOverStraightAlphaPixel(raster.rgba, offset, color[0], color[1], color[2], coverage);
      }
    });
  }
};

const samplePaintRasterBilinear = (
  raster: PaintRaster,
  x: number,
  y: number,
): [number, number, number, number] => {
  const sampleX = x - 0.5;
  const sampleY = y - 0.5;
  const x0 = Math.floor(sampleX);
  const y0 = Math.floor(sampleY);
  const tx = sampleX - x0;
  const ty = sampleY - y0;
  const result: [number, number, number, number] = [0, 0, 0, 0];

  for (let row = 0; row < 2; row += 1) {
    const sourceY = y0 + row;
    if (sourceY < 0 || sourceY >= raster.height) continue;
    const weightY = row === 0 ? 1 - ty : ty;
    for (let column = 0; column < 2; column += 1) {
      const sourceX = x0 + column;
      if (sourceX < 0 || sourceX >= raster.width) continue;
      const weight = weightY * (column === 0 ? 1 - tx : tx);
      const offset = (sourceY * raster.width + sourceX) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        result[channel] += raster.rgba[offset + channel] * weight;
      }
    }
  }

  return result;
};

const drawCloneStroke = (
  raster: PaintRaster,
  points: Point[],
  size: number,
  spacing: number,
  softness: number,
  opacity: number,
  cloneOffset: Point,
  cloneSource: PaintCloneSource,
  alphaOnly = false,
) => {
  const radius = Math.max(0.5, size / 2);
  const stamps = collectPaintStampPoints(points, Math.max(0.5, size * (spacing / 100)));
  const sourceRaster = alphaOnly ? cloneSource.alpha : cloneSource.rgb;

  for (const stamp of stamps) {
    const sourcePoint = getCloneSourceFromOffset(stamp, cloneOffset);
    if (!sourcePoint) continue;
    const destinationCenter = sceneToRasterPoint(stamp, raster.width, raster.height);
    const sourceCenter = sceneToRasterPoint(sourcePoint, sourceRaster.width, sourceRaster.height);

    forEachStampPixel(raster, destinationCenter, radius, (x, y, offset, distance) => {
      const coverage = getBrushCoverage(distance, radius, softness, opacity);
      if (coverage <= 0) return;
      const sample = samplePaintRasterBilinear(
        sourceRaster,
        sourceCenter.x + (x + 0.5 - destinationCenter.x),
        sourceCenter.y + (y + 0.5 - destinationCenter.y),
      );
      sourceOverStraightAlphaPixel(
        raster.rgba,
        offset,
        sample[0],
        sample[1],
        sample[2],
        coverage * sample[3],
      );
    });
  }
};

export interface PaintStrokeRasterParams {
  tool: PaintTool;
  points: Point[];
  width: number;
  height: number;
  size: number;
  spacing?: number;
  softness?: number;
  opacity: number;
  color: [number, number, number];
  alpha?: number;
  channels?: PaintStrokeChannels;
  cloneOffset?: Point | null;
  cloneSource?: PaintCloneSource | null;
}

interface PaintCompositeBuildOptions {
  resolveCloneSource?: (() => Promise<PaintCloneSource | null>) | null;
}

export interface PaintLivePreview {
  nodeId: string;
  cacheKey: string;
  cursor: number;
  tool: PaintTool;
  points: Point[];
  size: number;
  spacing: number;
  softness: number;
  opacity: number;
  color: [number, number, number];
  alpha: number;
  channels: PaintStrokeChannels;
  cloneOffset?: Point | null;
  cloneSource?: PaintCloneSource | null;
}

const rasterizePaintStroke = (
  raster: PaintRaster,
  params: PaintStrokeRasterParams,
  applyToExisting: boolean,
) => {
  const resolvedSoftness = resolvePaintSoftness({
    softness: params.softness,
  });
  const affectAlphaOnly = isAlphaOnlyPaintStroke(params.channels);

  if (params.tool === 'brush') {
    drawBrushStroke(
      raster,
      params.points,
      affectAlphaOnly ? getAlphaPaintColor(params.alpha ?? 1) : params.color,
      params.size,
      params.spacing ?? 20,
      resolvedSoftness,
      params.opacity,
    );
  } else if (params.tool === 'erase') {
    drawBrushStroke(
      raster,
      params.points,
      affectAlphaOnly ? ALPHA_ERASE_COLOR : ERASE_MASK_COLOR,
      params.size,
      params.spacing ?? 20,
      resolvedSoftness,
      params.opacity,
      applyToExisting && !affectAlphaOnly ? 'destination-out' : 'source-over',
    );
  } else if (params.tool === 'clone' && params.cloneSource && params.cloneOffset) {
    drawCloneStroke(
      raster,
      params.points,
      params.size,
      params.spacing ?? 20,
      resolvedSoftness,
      params.opacity,
      params.cloneOffset,
      params.cloneSource,
      affectAlphaOnly,
    );
  }
};

export const buildPaintStrokeRaster = (params: PaintStrokeRasterParams): PaintRaster | null => {
  if (params.points.length === 0) return null;
  const raster = createPaintRaster(params.width, params.height);
  rasterizePaintStroke(raster, params, false);
  return raster;
};

export const applyPaintStrokeToRaster = (
  raster: PaintRaster,
  params: PaintStrokeRasterParams,
): boolean => {
  if (params.points.length === 0) return false;
  if (raster.width !== params.width || raster.height !== params.height) {
    throw new Error('Paint stroke dimensions must match the destination raster.');
  }
  rasterizePaintStroke(raster, params, true);
  return true;
};

export const compositePaintRaster = (
  target: PaintRaster,
  source: PaintRaster,
  tool: PaintTool,
  channels?: PaintStrokeChannels,
) => {
  if (target.width !== source.width || target.height !== source.height) {
    throw new Error('Paint rasters must have matching dimensions for compositing.');
  }
  const eraseRgb = tool === 'erase' && !isAlphaOnlyPaintStroke(channels);
  for (let offset = 0; offset < target.rgba.length; offset += 4) {
    const sourceAlpha = source.rgba[offset + 3];
    if (eraseRgb) {
      destinationOutStraightAlphaPixel(target.rgba, offset, sourceAlpha);
      continue;
    }
    sourceOverStraightAlphaPixel(
      target.rgba,
      offset,
      source.rgba[offset],
      source.rgba[offset + 1],
      source.rgba[offset + 2],
      sourceAlpha,
    );
  }
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

const buildPaintCompositeRasterForChannels = async (
  strokes: PaintStroke[],
  width: number,
  height: number,
  layers?: PaintLayer[],
  frame?: number,
  alphaOnly = false,
  options: PaintCompositeBuildOptions = {},
): Promise<PaintRaster | null> => {
  const paintNode = { layers, strokes };
  const visibleStrokes = flattenPaintHierarchyStrokeItems(buildPaintHierarchy(paintNode, frame))
    .filter(
      (item) =>
        item.visible &&
        item.activeAtFrame &&
        item.stroke.raster &&
        isAlphaOnlyPaintStroke(item.stroke.channels) === alphaOnly,
    )
    .map((item) => item.stroke);

  if (visibleStrokes.length === 0) return null;

  const composite = createPaintRaster(width, height);
  let cloneSourcePromise: Promise<PaintCloneSource | null> | null = null;

  const getCloneSource = async (): Promise<PaintCloneSource | null> => {
    if (!options.resolveCloneSource) {
      return null;
    }

    cloneSourcePromise ??= options.resolveCloneSource();
    return cloneSourcePromise;
  };

  for (const stroke of [...visibleStrokes].reverse()) {
    let strokeRaster: PaintRaster | null = null;

    if (stroke.tool === 'clone' && stroke.path?.points.length && stroke.cloneOffset) {
      const cloneSource = await getCloneSource();
      if (cloneSource) {
        strokeRaster = buildPaintStrokeRaster({
          tool: stroke.tool,
          points: stroke.path.points,
          width,
          height,
          size: stroke.size,
          spacing: stroke.spacing,
          softness: stroke.softness,
          opacity: stroke.opacity,
          color: stroke.color ?? [1, 1, 1],
          alpha: stroke.alpha,
          channels: stroke.channels,
          cloneOffset: stroke.cloneOffset,
          cloneSource,
        });
      }
    }

    if (!strokeRaster && stroke.raster) {
      strokeRaster = await loadPaintRaster(stroke.raster);
    }

    if (!strokeRaster) {
      continue;
    }

    compositePaintRaster(composite, strokeRaster, stroke.tool, stroke.channels);
  }

  return composite;
};

export const buildPaintCompositeRaster = (
  strokes: PaintStroke[],
  width: number,
  height: number,
  layers?: PaintLayer[],
  frame?: number,
  options: PaintCompositeBuildOptions = {},
): Promise<PaintRaster | null> =>
  buildPaintCompositeRasterForChannels(strokes, width, height, layers, frame, false, options);

export const buildPaintAlphaCompositeRaster = (
  strokes: PaintStroke[],
  width: number,
  height: number,
  layers?: PaintLayer[],
  frame?: number,
  options: PaintCompositeBuildOptions = {},
): Promise<PaintRaster | null> =>
  buildPaintCompositeRasterForChannels(strokes, width, height, layers, frame, true, options);

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
