import { describe, expect, it } from 'vitest';
import { BlendMode, NodeType, type AnyNode } from '@blackboard/types';
import {
  clampNormalizedRect,
  normalizeViewportWorkingArea,
  normalizedRectFromScenePoints,
  resolveViewportAssetReadRegion,
  resolveWorkingAreaPixelRect,
} from './workingArea';

describe('viewport working area', () => {
  it('normalizes an unordered scene-space drag', () => {
    expect(
      normalizedRectFromScenePoints(
        { x: 400, y: 250 },
        { x: -400, y: -250 },
        {
          width: 1920,
          height: 1080,
        },
      ),
    ).toEqual({
      x: 560 / 1920,
      y: 290 / 1080,
      width: 800 / 1920,
      height: 500 / 1080,
    });
  });

  it('clamps rectangles to the display window', () => {
    expect(clampNormalizedRect({ x: -0.2, y: 0.8, width: 2, height: 0.5 })).toEqual({
      x: 0,
      y: 0.8,
      width: 1,
      height: 0.19999999999999996,
    });
  });

  it('resolves integer pixels that fully cover the normalized selection', () => {
    expect(
      resolveWorkingAreaPixelRect(
        { enabled: true, rect: { x: 0.1, y: 0.2, width: 0.25, height: 0.5 } },
        { width: 100, height: 80 },
      ),
    ).toEqual({ x: 10, y: 16, width: 25, height: 40 });
  });

  it('sanitizes a persisted working area and falls back safely for older projects', () => {
    expect(
      normalizeViewportWorkingArea({
        enabled: true,
        rect: { x: -0.1, y: 0.25, width: 0.5, height: 2 },
      }),
    ).toEqual({
      enabled: true,
      rect: { x: 0, y: 0.25, width: 0.5, height: 0.75 },
    });
    expect(normalizeViewportWorkingArea(undefined)).toEqual({
      enabled: false,
      rect: { x: 0, y: 0, width: 1, height: 1 },
    });
  });

  it('only retains cropped source pixels for an identity scene-sized asset', () => {
    const identityTransform = { x: 0, y: 0, scaleX: 1, scaleY: 1, fitMode: 'fit' };
    const node = {
      id: 'plate',
      type: NodeType.MEDIA_SOURCE,
      name: 'Plate',
      enabled: true,
      src: 'asset-1',
      mediaKind: 'image',
      width: 100,
      height: 80,
      opacity: 100,
      operator: BlendMode.OVER,
      transform: identityTransform,
    } as AnyNode;
    const options = {
      assetId: 'asset-1',
      nodes: [node],
      scene: { width: 100, height: 80 },
      frame: 0,
      workingArea: {
        enabled: true,
        rect: { x: 0.1, y: 0.2, width: 0.25, height: 0.5 },
      },
    };

    expect(resolveViewportAssetReadRegion(options)).toEqual({
      x: 10,
      y: 16,
      width: 25,
      height: 40,
    });
    expect(
      resolveViewportAssetReadRegion({
        ...options,
        nodes: [{ ...node, transform: { ...identityTransform, scaleX: 0.5 } } as AnyNode],
      }),
    ).toBeNull();
  });
});
