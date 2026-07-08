import { describe, expect, it, vi } from 'vitest';
import type { ProjectColorManagement } from '@blackboard/types';
import { collectColorManagementDiagnostics, formatColorManagementDiagnostics } from './diagnostics';
import { createDefaultViewerColorManagement } from './viewerIntent';
import type { ColorManagementRuntimeSnapshot } from './types';

const runtime = {
  isInitialized: true,
  isLoading: false,
  error: null,
  errorDetail: null,
  version: '2.5.0',
  versionHex: 0x20500,
  configName: 'ocio://aces',
} satisfies Pick<
  ColorManagementRuntimeSnapshot,
  'isInitialized' | 'isLoading' | 'error' | 'errorDetail' | 'version' | 'versionHex' | 'configName'
>;

const project: ProjectColorManagement = {
  schemaVersion: 1,
  config: { kind: 'builtin', id: 'aces', uri: 'ocio://aces' },
  workingSpace: { role: 'scene_linear' },
  viewer: { display: 'sRGB - Display', view: 'SDR Video' },
  roleOverrides: { texture_paint: 'Texture Space' },
  context: { SHOT: '010' },
};

describe('color-management diagnostics', () => {
  it('collects resolved project intent, cache state, and renderer capabilities', () => {
    const service = {
      getDiagnostics: vi.fn(() => ({
        processorCacheEntries: 2,
        shaderCacheEntries: 3,
        rgbTransformCacheEntries: 4,
        shaderProfile: 'GLSL ES 3.0' as const,
        latestFailure: null,
      })),
      resolveProjectColorManagement: vi.fn(() => ({
        project,
        config: project.config,
        workingColorSpace: 'ACEScg',
        textureColorSpace: 'Texture Space',
        colorPickingColorSpace: 'Color Picking',
        dataColorSpace: 'Raw',
        display: project.viewer.display,
        view: project.viewer.view,
        context: project.context ?? {},
      })),
    };
    const viewer = {
      displayViewOverride: {
        display: 'Display P3',
        view: 'HDR Video',
      },
      autoDetectView: null,
    };

    const result = collectColorManagementDiagnostics(runtime, project, viewer, service, {
      webgl2: 'supported',
      floatRenderTargets: 'supported',
      rendererCount: 2,
      latestFailure: null,
    });

    expect(result.project).toMatchObject({
      status: 'ready',
      display: 'Display P3',
      view: 'HDR Video',
      context: { SHOT: '010' },
      overrides: ['texture_paint=Texture Space'],
      localDisplayOverride: true,
    });
    expect(result.service.shaderCacheEntries).toBe(3);
    expect(formatColorManagementDiagnostics(runtime, result)).toContain(
      'Caches: processors=2, shaders=3, rgb=4',
    );
  });

  it('reports an explicit invalid project instead of substituting defaults', () => {
    const result = collectColorManagementDiagnostics(
      runtime,
      project,
      createDefaultViewerColorManagement(),
      {
        getDiagnostics: () => ({
          processorCacheEntries: 0,
          shaderCacheEntries: 0,
          rgbTransformCacheEntries: 0,
          shaderProfile: 'GLSL ES 3.0',
          latestFailure: null,
        }),
        resolveProjectColorManagement: () => {
          throw new Error('Project display is missing.');
        },
      },
      {
        webgl2: 'unverified',
        floatRenderTargets: 'unverified',
        rendererCount: 0,
        latestFailure: null,
      },
    );

    expect(result.project.status).toBe('invalid');
    expect(result.project.issue).toBe('Project display is missing.');
  });
});
