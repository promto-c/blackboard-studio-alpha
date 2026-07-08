import { beforeAll, describe, expect, it } from 'vitest';
import { colorManagementService } from './service';

describe('bundled native OCIO GPU processing', () => {
  beforeAll(async () => {
    const snapshot = await colorManagementService.initialize();
    if (snapshot.error) throw new Error(snapshot.error);
  });

  it('generates GLSL ES 3.0 for color-space and display/view processors', () => {
    const colorSpaceShader = colorManagementService.getColorSpaceShader(
      'sRGB Encoded Rec.709 (sRGB)',
      'ACEScg',
    );
    const snapshot = colorManagementService.getSnapshot();
    const displayShader = colorManagementService.getDisplayViewShader(
      snapshot.workingColorSpace,
      snapshot.defaultDisplay,
      snapshot.defaultView,
    );

    for (const shader of [colorSpaceShader, displayShader]) {
      expect(shader).not.toBeNull();
      expect(shader?.language).toBe('glsl_es_3.0');
      expect(shader?.shaderText).toContain(shader?.functionName);
      expect(shader?.shaderText.trim().length).toBeGreaterThan(0);
      expect(shader?.cacheId).toBeTruthy();
    }
    expect(colorManagementService.getDiagnostics()).toMatchObject({
      shaderCacheEntries: 2,
      shaderProfile: 'GLSL ES 3.0',
    });
  });
});
