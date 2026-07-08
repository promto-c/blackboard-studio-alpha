import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Scene3DAssetReference } from '@blackboard/types';
import { createDefaultScene3DSettings } from '@/nodes/builtin/scene_3d/scene3d';
import {
  SCENE_3D_PREVIEW_COLOR_BOUNDARY,
  createScene3DPreviewAssetKey,
  configureScene3DDisplayBackdropTexture,
  configureScene3DPreviewRenderer,
} from './scene3dPreviewRenderer';

describe('Scene 3D preview color boundary', () => {
  it('declares a viewport-only display-referred output contract', () => {
    expect(SCENE_3D_PREVIEW_COLOR_BOUNDARY).toEqual({
      outputContract: 'viewport_preview',
      rendererWorkingSpace: 'Linear-sRGB',
      canvasOutputSpace: 'sRGB',
      backdropInput: 'display_referred',
    });
  });

  it('uses explicit Three.js preview output without tone mapping', () => {
    const renderer = {
      outputColorSpace: '',
      toneMapping: -1,
      toneMappingExposure: 0,
    } as unknown as THREE.WebGLRenderer;

    configureScene3DPreviewRenderer(renderer);

    expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
    expect(renderer.toneMappingExposure).toBe(1);
  });

  it('marks the already-displayed 2D backdrop for an sRGB decode/encode round trip', () => {
    const texture = configureScene3DDisplayBackdropTexture(new THREE.Texture());

    expect(texture.flipY).toBe(false);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(texture.premultiplyAlpha).toBe(false);
    expect(texture.generateMipmaps).toBe(false);
  });

  it('keeps preview asset identity stable across camera and backdrop-distance edits', () => {
    const asset: Scene3DAssetReference = {
      assetId: 'asset:splat',
      fileName: 'scan.spz',
      format: 'spz',
      kind: 'splat',
    };
    const item = {
      type: 'splat',
      color: '#ffffff',
      asset,
    } as const;
    const scene3d = createDefaultScene3DSettings(1920, 1080);
    const changedCameraScene3d = {
      ...scene3d,
      bounds: {
        ...scene3d.bounds,
        z: scene3d.bounds.z * 1.5,
      },
      camera: {
        ...scene3d.camera,
        fov: scene3d.camera.fov + 10,
        position: {
          ...scene3d.camera.position,
          z: scene3d.camera.position.z * 1.5,
        },
      },
    };

    expect(createScene3DPreviewAssetKey(item, changedCameraScene3d)).toBe(
      createScene3DPreviewAssetKey(item, scene3d),
    );
  });

  it('invalidates preview asset identity when pixel scale changes', () => {
    const asset: Scene3DAssetReference = {
      assetId: 'asset:model',
      fileName: 'model.glb',
      format: 'glb',
      kind: 'mesh',
    };
    const item = {
      type: 'model',
      color: '#ffffff',
      asset,
    } as const;
    const scene3d = createDefaultScene3DSettings(1920, 1080);
    const changedScaleScene3d = {
      ...scene3d,
      world: {
        ...scene3d.world,
        pixelScale: scene3d.world.pixelScale * 2,
      },
    };

    expect(createScene3DPreviewAssetKey(item, changedScaleScene3d)).not.toBe(
      createScene3DPreviewAssetKey(item, scene3d),
    );
  });
});
