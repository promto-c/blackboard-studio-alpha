import type { AnyNode, NormalizedRect, SceneNode, ViewportWorkingArea } from '@blackboard/types';
import { getValueAtFrame } from '@blackboard/renderer';
import { getNodeAssetIds } from '@/nodes/helpers';

export const VIEWPORT_WORKING_AREA_TOOL = 'working_area';
export const MIN_WORKING_AREA_NORMALIZED_SIZE = 0.001;

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const finiteOr = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

export const clampNormalizedRect = (rect: NormalizedRect): NormalizedRect => {
  const x0 = Math.min(1 - MIN_WORKING_AREA_NORMALIZED_SIZE, Math.max(0, finiteOr(rect.x, 0)));
  const y0 = Math.min(1 - MIN_WORKING_AREA_NORMALIZED_SIZE, Math.max(0, finiteOr(rect.y, 0)));
  const x1 = Math.min(1, Math.max(x0, x0 + finiteOr(rect.width, 1)));
  const y1 = Math.min(1, Math.max(y0, y0 + finiteOr(rect.height, 1)));

  return {
    x: x0,
    y: y0,
    width: Math.max(MIN_WORKING_AREA_NORMALIZED_SIZE, x1 - x0),
    height: Math.max(MIN_WORKING_AREA_NORMALIZED_SIZE, y1 - y0),
  };
};

export const normalizeViewportWorkingArea = (value: unknown): ViewportWorkingArea => {
  const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  const candidateRect =
    candidate?.rect && typeof candidate.rect === 'object'
      ? (candidate.rect as Record<string, unknown>)
      : null;
  const numberOr = (rectValue: unknown, fallback: number) =>
    typeof rectValue === 'number' && Number.isFinite(rectValue) ? rectValue : fallback;

  return {
    enabled: candidate?.enabled === true,
    rect: clampNormalizedRect({
      x: numberOr(candidateRect?.x, 0),
      y: numberOr(candidateRect?.y, 0),
      width: numberOr(candidateRect?.width, 1),
      height: numberOr(candidateRect?.height, 1),
    }),
  };
};

export const normalizedRectFromScenePoints = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  scene: Pick<SceneNode, 'width' | 'height'>,
): NormalizedRect => {
  const left = Math.min(start.x, end.x) + scene.width / 2;
  const top = Math.min(start.y, end.y) + scene.height / 2;
  const right = Math.max(start.x, end.x) + scene.width / 2;
  const bottom = Math.max(start.y, end.y) + scene.height / 2;

  return clampNormalizedRect({
    x: left / Math.max(1, scene.width),
    y: top / Math.max(1, scene.height),
    width: (right - left) / Math.max(1, scene.width),
    height: (bottom - top) / Math.max(1, scene.height),
  });
};

export const resolveWorkingAreaPixelRect = (
  workingArea: ViewportWorkingArea | null | undefined,
  scene: Pick<SceneNode, 'width' | 'height'> | null | undefined,
): PixelRect | null => {
  if (!workingArea?.enabled || !scene || scene.width <= 0 || scene.height <= 0) return null;
  const rect = clampNormalizedRect(workingArea.rect);
  const x = Math.max(0, Math.min(scene.width - 1, Math.floor(rect.x * scene.width)));
  const y = Math.max(0, Math.min(scene.height - 1, Math.floor(rect.y * scene.height)));
  const right = Math.max(
    x + 1,
    Math.min(scene.width, Math.ceil((rect.x + rect.width) * scene.width)),
  );
  const bottom = Math.max(
    y + 1,
    Math.min(scene.height, Math.ceil((rect.y + rect.height) * scene.height)),
  );
  return { x, y, width: right - x, height: bottom - y };
};

export const getWorkingAreaCoverage = (
  rect: PixelRect,
  scene: Pick<SceneNode, 'width' | 'height'>,
) => (rect.width * rect.height) / Math.max(1, scene.width * scene.height);

const isIdentitySceneSource = (
  node: AnyNode,
  scene: Pick<SceneNode, 'width' | 'height'>,
  frame: number,
): boolean => {
  const candidate = node as AnyNode & {
    width?: number;
    height?: number;
    transform?: {
      x: Parameters<typeof getValueAtFrame>[0];
      y: Parameters<typeof getValueAtFrame>[0];
      scaleX: Parameters<typeof getValueAtFrame>[0];
      scaleY: Parameters<typeof getValueAtFrame>[0];
    };
  };
  if (
    candidate.width !== scene.width ||
    candidate.height !== scene.height ||
    !candidate.transform
  ) {
    return false;
  }

  return (
    Math.abs(getValueAtFrame(candidate.transform.x, frame)) < 0.0001 &&
    Math.abs(getValueAtFrame(candidate.transform.y, frame)) < 0.0001 &&
    Math.abs(getValueAtFrame(candidate.transform.scaleX, frame) - 1) < 0.0001 &&
    Math.abs(getValueAtFrame(candidate.transform.scaleY, frame) - 1) < 0.0001
  );
};

/**
 * Returns a safe retained-pixel crop for an asset. Region decoding is only
 * enabled when every use is an identity, scene-sized source. More complicated
 * transforms deliberately stay on the full-frame fallback path.
 */
export const resolveViewportAssetReadRegion = ({
  assetId,
  nodes,
  scene,
  frame,
  workingArea,
}: {
  assetId: string;
  nodes: AnyNode[];
  scene: Pick<SceneNode, 'width' | 'height'> | null | undefined;
  frame: number;
  workingArea: ViewportWorkingArea | null | undefined;
}): PixelRect | null => {
  const pixelRect = resolveWorkingAreaPixelRect(workingArea, scene);
  if (!pixelRect || !scene) return null;
  if (pixelRect.width >= scene.width && pixelRect.height >= scene.height) return null;

  const usages = nodes.filter((node) => getNodeAssetIds(node).includes(assetId));
  if (usages.length === 0 || usages.some((node) => !isIdentitySceneSource(node, scene, frame))) {
    return null;
  }
  return pixelRect;
};

export const getWorkingAreaSignature = (rect: PixelRect | null): string =>
  rect ? `${rect.x}:${rect.y}:${rect.width}:${rect.height}` : 'full';
