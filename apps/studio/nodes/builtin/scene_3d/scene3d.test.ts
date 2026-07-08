import { describe, expect, it } from 'vitest';
import type { Scene3DAssetReference, Scene3DNode } from '@blackboard/types';
import {
  createScene3DAssetItem,
  createScene3DSettingsWithAsset,
  createDefaultScene3DSettings,
  getScene3DBackdropDistanceForCanvas,
  getScene3DBackdropRect,
  getScene3DCameraDistance,
  normalizeScene3DSettings,
  setScene3DBackdropDistance,
} from './scene3d';

const canvasSize = { width: 1920, height: 1080 };

const scene3DNode = (scene3d: Scene3DNode['scene3d']): Pick<Scene3DNode, 'scene3d'> => ({
  scene3d,
});

describe('scene3d settings', () => {
  it('creates a ready-to-view scene around an imported asset', () => {
    const asset: Scene3DAssetReference = {
      assetId: 'asset:splat',
      fileName: 'result.spz',
      kind: 'splat',
      format: 'spz',
    };
    const settings = createScene3DSettingsWithAsset(asset, 1280, 720);

    expect(settings.items.at(-1)).toMatchObject({
      name: 'result',
      type: 'splat',
      asset,
    });
  });

  it('does not expose a background field on the world settings', () => {
    const settings = createDefaultScene3DSettings(1920, 1080);

    expect(settings.world).not.toHaveProperty('background');
  });

  it('stores explicit HDR environment lighting settings', () => {
    const settings = createDefaultScene3DSettings(1920, 1080);

    expect(settings.world).toMatchObject({
      environmentColor: '#ffffff',
      environmentGroundColor: '#1f2937',
      environmentIntensity: 1.2,
    });
  });

  it('derives the default scene rect from the camera fov and backdrop distance', () => {
    const settings = createDefaultScene3DSettings(1920, 1080);
    const expectedDistance = getScene3DBackdropDistanceForCanvas(canvasSize, settings.camera.fov);

    expect(settings.bounds.x).toBeCloseTo(1920, 4);
    expect(settings.bounds.y).toBeCloseTo(1080, 4);
    expect(settings.bounds.z).toBeCloseTo(expectedDistance, 4);
    expect(getScene3DCameraDistance(settings.camera)).toBeCloseTo(settings.bounds.z, 4);
  });

  it('normalizes the scene rect to the fov plane at the stored backdrop distance', () => {
    const settings = createDefaultScene3DSettings(1920, 1080);
    const distance = 1000;
    const fov = 60;
    const expectedRect = getScene3DBackdropRect({ canvasSize, fov, distance });
    const normalized = normalizeScene3DSettings(
      scene3DNode({
        ...settings,
        bounds: {
          ...settings.bounds,
          z: distance,
        },
        camera: {
          ...settings.camera,
          fov,
          position: { x: 0, y: 0, z: 2500 },
        },
      }),
      canvasSize,
    );
    const outputPlane = normalized.items.find((item) => item.type === 'output_plane');

    expect(normalized.bounds.x).toBeCloseTo(expectedRect.width, 4);
    expect(normalized.bounds.y).toBeCloseTo(expectedRect.height, 4);
    expect(normalized.bounds.z).toBe(distance);
    expect(outputPlane?.size?.x).toBeCloseTo(expectedRect.width, 4);
    expect(outputPlane?.size?.y).toBeCloseTo(expectedRect.height, 4);
    expect(getScene3DCameraDistance(normalized.camera)).toBeCloseTo(distance, 4);
  });

  it('normalizes environment intensity without display-range clamping', () => {
    const settings = createDefaultScene3DSettings(1920, 1080);
    const normalized = normalizeScene3DSettings(
      scene3DNode({
        ...settings,
        world: {
          ...settings.world,
          environmentColor: '#88aaff',
          environmentGroundColor: '#111827',
          environmentIntensity: 12.5,
        },
      }),
      canvasSize,
    );

    expect(normalized.world.environmentColor).toBe('#88aaff');
    expect(normalized.world.environmentGroundColor).toBe('#111827');
    expect(normalized.world.environmentIntensity).toBe(12.5);
  });

  it('uses backdrop distance edits to move the camera along its view direction', () => {
    const settings = createDefaultScene3DSettings(1920, 1080);
    const moved = setScene3DBackdropDistance(
      {
        ...settings,
        camera: {
          ...settings.camera,
          position: { x: 10, y: 0, z: 0 },
          target: { x: 0, y: 0, z: 0 },
        },
      },
      250,
    );

    expect(moved.bounds.z).toBe(250);
    expect(moved.camera.position.x).toBeCloseTo(250, 4);
    expect(moved.camera.position.y).toBeCloseTo(0, 4);
    expect(moved.camera.position.z).toBeCloseTo(0, 4);
    expect(getScene3DCameraDistance(moved.camera)).toBeCloseTo(250, 4);
  });

  it('creates and normalizes imported model items with their asset reference', () => {
    const settings = createDefaultScene3DSettings(1920, 1080);
    const asset: Scene3DAssetReference = {
      assetId: 'asset_model',
      fileName: 'demo-model.glb',
      kind: 'mesh',
      format: 'glb',
      mimeType: 'model/gltf-binary',
      size: 1024,
    };

    const item = createScene3DAssetItem(settings, asset);
    const normalized = normalizeScene3DSettings(
      scene3DNode({
        ...settings,
        items: [...settings.items, item],
      }),
      canvasSize,
    );

    const imported = normalized.items.find((candidate) => candidate.id === item.id);
    expect(imported).toMatchObject({
      name: 'demo-model',
      type: 'model',
      asset,
    });
  });

  it('creates and normalizes imported gaussian splat items with their asset reference', () => {
    const settings = createDefaultScene3DSettings(1920, 1080);
    const asset: Scene3DAssetReference = {
      assetId: 'asset_splat',
      fileName: 'scan.spz',
      kind: 'splat',
      format: 'spz',
      size: 2048,
    };

    const item = createScene3DAssetItem(settings, asset);
    const normalized = normalizeScene3DSettings(
      scene3DNode({
        ...settings,
        items: [...settings.items, item],
      }),
      canvasSize,
    );

    const imported = normalized.items.find((candidate) => candidate.id === item.id);
    expect(imported).toMatchObject({
      name: 'scan',
      type: 'splat',
      asset,
    });
  });
});
