import * as THREE from 'three';
import { readRenderTargetRgbaFloat } from '@blackboard/renderer';

export interface PaintRaster {
  width: number;
  height: number;
  rgba: Float32Array;
}

export interface PaintCloneSource {
  rgb: PaintRaster;
  alpha: PaintRaster;
}

export const readStraightAlphaRenderTargetRgba = (
  renderer: THREE.WebGLRenderer,
  renderTarget: THREE.WebGLRenderTarget,
): Float32Array => readRenderTargetRgbaFloat(renderer, renderTarget);

export const createOpaqueCloneRgbPixels = (source: Float32Array): Float32Array => {
  if (source.length % 4 !== 0) {
    throw new Error('Clone source pixels must contain complete RGBA samples.');
  }

  const rgb = source.slice();
  for (let index = 3; index < rgb.length; index += 4) {
    rgb[index] = 1;
  }
  return rgb;
};

export const createCloneAlphaPixels = (source: Float32Array): Float32Array => {
  if (source.length % 4 !== 0) {
    throw new Error('Clone source pixels must contain complete RGBA samples.');
  }

  const alpha = new Float32Array(source.length);
  for (let index = 0; index < alpha.length; index += 4) {
    const value = source[index + 3];
    alpha[index] = value;
    alpha[index + 1] = value;
    alpha[index + 2] = value;
    alpha[index + 3] = 1;
  }
  return alpha;
};

export const renderTargetToPaintCloneSource = (
  renderer: THREE.WebGLRenderer,
  renderTarget: THREE.WebGLRenderTarget,
): PaintCloneSource => {
  const rgba = readStraightAlphaRenderTargetRgba(renderer, renderTarget);
  return {
    rgb: {
      width: renderTarget.width,
      height: renderTarget.height,
      rgba: createOpaqueCloneRgbPixels(rgba),
    },
    alpha: {
      width: renderTarget.width,
      height: renderTarget.height,
      rgba: createCloneAlphaPixels(rgba),
    },
  };
};
