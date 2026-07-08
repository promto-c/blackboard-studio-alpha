import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  getRenderTargetOptionsForOutput,
  getSceneRenderTargetOptions,
} from '../../../packages/renderer/src/pipeline';

describe('compositing working precision', () => {
  it.each([
    [8, THREE.HalfFloatType],
    [16, THREE.HalfFloatType],
    [32, THREE.FloatType],
  ] as const)('uses floating-point targets for a %i-bit scene', (bitDepth, expectedType) => {
    const options = getSceneRenderTargetOptions({ bitDepth });

    expect(options.type).toBe(expectedType);
    expect(options.format).toBe(THREE.RGBAFormat);
    expect(options.colorSpace).toBeUndefined();
    expect(options.depthBuffer).toBe(false);
    expect(options.stencilBuffer).toBe(false);
  });

  it('uses full-float targets for technical data outputs', () => {
    const options = getRenderTargetOptionsForOutput(
      { bitDepth: 8 },
      { kind: 'data', sourceNodeId: 'depth', sourcePort: 'Z', semantic: 'depth' },
    );
    expect(options.type).toBe(THREE.FloatType);
    expect(options.minFilter).toBe(THREE.LinearFilter);
    expect(options.magFilter).toBe(THREE.LinearFilter);
  });

  it.each(['id', 'cryptomatte'] as const)(
    'uses nearest filtering for discrete %s outputs',
    (semantic) => {
      const options = getRenderTargetOptionsForOutput(
        { bitDepth: 16 },
        { kind: 'data', sourceNodeId: 'data', sourcePort: semantic, semantic },
      );

      expect(options.type).toBe(THREE.FloatType);
      expect(options.minFilter).toBe(THREE.NearestFilter);
      expect(options.magFilter).toBe(THREE.NearestFilter);
    },
  );
});
