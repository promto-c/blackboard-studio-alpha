import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getSceneRenderTargetOptions } from '../../../packages/renderer/src/pipeline';

describe('compositing working precision', () => {
  it.each([
    [8, THREE.HalfFloatType],
    [16, THREE.HalfFloatType],
    [32, THREE.FloatType],
  ] as const)('uses floating-point targets for a %i-bit scene', (bitDepth, expectedType) => {
    expect(getSceneRenderTargetOptions({ bitDepth }).type).toBe(expectedType);
  });
});
