import * as THREE from 'three';
import type { Scene3DItem, Scene3DSettings } from '@blackboard/types';
import { configureStraightAlphaTexture, createStudioRenderer } from '@blackboard/renderer';

export const SCENE_3D_PREVIEW_COLOR_BOUNDARY = {
  outputContract: 'viewport_preview',
  rendererWorkingSpace: 'Linear-sRGB',
  canvasOutputSpace: 'sRGB',
  backdropInput: 'display_referred',
} as const;

export const configureScene3DPreviewRenderer = (
  renderer: THREE.WebGLRenderer,
): THREE.WebGLRenderer => {
  if (renderer.outputColorSpace !== THREE.SRGBColorSpace) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
  return renderer;
};

export const createScene3DPreviewRenderer = (): THREE.WebGLRenderer =>
  configureScene3DPreviewRenderer(
    createStudioRenderer({
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
      depth: true,
      stencil: false,
    }),
  );

export const configureScene3DDisplayBackdropTexture = <T extends THREE.Texture>(texture: T): T => {
  configureStraightAlphaTexture(texture);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
};

export const createScene3DPreviewAssetKey = (
  item: Pick<Scene3DItem, 'type' | 'asset' | 'color'>,
  scene3d: Pick<Scene3DSettings, 'world'>,
): string | null => {
  if (!item.asset?.assetId) return null;
  return [
    item.type,
    item.asset.assetId,
    item.asset.kind ?? '',
    item.asset.format ?? '',
    item.color ?? '',
    scene3d.world.pixelScale,
  ].join('|');
};
