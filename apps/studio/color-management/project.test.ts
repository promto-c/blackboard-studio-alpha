import { describe, expect, it } from 'vitest';
import { createProjectColorManagementFromOcioDefaults } from './project';

describe('project color-management defaults', () => {
  it('uses the defaults reported by the selected OCIO config', () => {
    const config = {
      kind: 'builtin' as const,
      id: 'studio-config-v1',
      uri: 'ocio://studio-config-v1',
    };

    expect(
      createProjectColorManagementFromOcioDefaults(config, {
        defaultDisplay: 'sRGB - Display',
        defaultView: 'ACES 1.0 - SDR Video',
      }),
    ).toMatchObject({
      config,
      workingSpace: { role: 'scene_linear' },
      viewer: {
        display: 'sRGB - Display',
        view: 'ACES 1.0 - SDR Video',
      },
    });
  });
});
