// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  colorManagementService,
  createDefaultProjectColorManagement,
  registerExternalOcioConfigPackage,
  removeExternalOcioConfigPackage,
  ColorManagementDefaults,
  createBuiltinProjectColorConfigReference,
} from '@/color-management';
import { PreferencesProvider } from './preferencesContext';
import { getProjectRuntimeOcioConfig, OcioProvider, useOcio } from './ocioContext';

const pwaMocks = vi.hoisted(() => ({
  refreshPwaCacheStatus: vi.fn(async () => undefined),
}));

const ocioMocks = vi.hoisted(() => {
  let createBuiltinConfigError: Error | null = null;
  let includeRawDisplayView = true;
  let omittedRoleName: string | null = null;
  let missingColorSpaceRoleName: string | null = null;
  let includeMissingOptionalRole = false;
  let createColorSpaceProcessorImplementation: () => unknown = () => {
    throw new Error('Processor unavailable');
  };
  const createColorSpaceProcessor = vi.fn(
    (
      _source: string,
      _destination: string,
      _options?: { optimization?: string; context?: Readonly<Record<string, string>> },
    ) => createColorSpaceProcessorImplementation(),
  );
  const createDisplayViewProcessor = vi.fn(() => {
    throw new Error('Display processor unavailable');
  });
  const mkdirp = vi.fn();
  const writeFile = vi.fn();
  const createConfigFromFile = vi.fn();

  const createViews = () => [
    {
      name: 'ACES 2.0 - SDR 100 nits (Rec.709)',
      colorSpace: 'ACEScg',
      transform: 'display',
      looks: 'Studio Look',
    },
    ...(includeRawDisplayView
      ? [
          {
            name: 'Raw',
            colorSpace: 'Raw',
            transform: 'data',
            looks: '',
          },
        ]
      : []),
  ];

  const createRoles = () =>
    [
      { name: 'scene_linear', colorSpace: 'ACEScg' },
      { name: 'texture_paint', colorSpace: 'sRGB Encoded Rec.709 (sRGB)' },
      { name: 'color_picking', colorSpace: 'sRGB Encoded Rec.709 (sRGB)' },
      { name: 'data', colorSpace: 'Raw' },
      ...(includeMissingOptionalRole
        ? [{ name: 'compositing_log', colorSpace: 'Missing Log Space' }]
        : []),
    ]
      .filter((role) => role.name !== omittedRoleName)
      .map((role) =>
        role.name === missingColorSpaceRoleName
          ? { ...role, colorSpace: 'Missing Color Space' }
          : role,
      );

  const createConfig = () => ({
    validate: vi.fn(() => true),
    listColorSpaces: () => [
      {
        name: 'ACEScg',
        canonicalName: 'ACEScg',
        aliases: [],
        categories: [],
        family: 'ACES',
        encoding: 'scene-linear',
        description: 'ACEScg scene linear',
        isData: false,
      },
      {
        name: 'sRGB Encoded Rec.709 (sRGB)',
        canonicalName: 'sRGB Encoded Rec.709 (sRGB)',
        aliases: ['sRGB'],
        categories: [],
        family: 'Input',
        encoding: 'sRGB',
        description: 'sRGB texture space',
        isData: false,
      },
      {
        name: 'ACES2065-1',
        canonicalName: 'ACES2065-1',
        aliases: [],
        categories: [],
        family: 'ACES',
        encoding: 'scene-linear',
        description: 'ACES scene-linear interchange',
        isData: false,
      },
      {
        name: 'Raw',
        canonicalName: 'Raw',
        aliases: [],
        categories: [],
        family: 'Data',
        encoding: '',
        description: 'Data space',
        isData: true,
      },
      {
        name: 'ACEScct',
        canonicalName: 'ACEScct',
        aliases: [],
        categories: [],
        family: 'ACES',
        encoding: 'log',
        description: 'ACES log grading space',
        isData: false,
      },
      {
        name: 'sRGB Display',
        canonicalName: 'sRGB Display',
        aliases: [],
        categories: [],
        family: 'Display',
        encoding: 'display',
        description: 'Display-referred sRGB',
        isData: false,
      },
    ],
    listRoles: createRoles,
    listDisplays: () => ['sRGB - Display'],
    getDefaultDisplay: () => 'sRGB - Display',
    getDefaultView: () => 'ACES 2.0 - SDR 100 nits (Rec.709)',
    createColorSpaceProcessor,
    createDisplayViewProcessor,
    matchFileRule: (filePath: string) =>
      filePath.endsWith('.exr')
        ? {
            colorSpace: 'ACES2065-1',
            ruleIndex: 0,
            ruleName: 'EXR',
            isDefaultRule: false,
            custom: {},
          }
        : {
            colorSpace: 'texture_paint',
            ruleIndex: 1,
            ruleName: 'Default',
            isDefaultRule: true,
            custom: {},
          },
    listViews: createViews,
    getView: (_display: string, view: string) => {
      const viewInfo = createViews().find((candidate) => candidate.name === view);
      if (!viewInfo) throw new Error(`Unknown view ${view}`);
      return viewInfo;
    },
    dispose: vi.fn(),
  });

  const createRuntime = () => ({
    version: '2.5.0',
    versionHex: 0x20500,
    listBuiltinConfigs: () => [{ name: 'cg-config-v4.0.0_aces-v2.0_ocio-v2.5' }],
    createBuiltinConfig: () => {
      if (createBuiltinConfigError) {
        throw createBuiltinConfigError;
      }
      return createConfig();
    },
    createConfigFromFile: (path: string) => {
      createConfigFromFile(path);
      return createConfig();
    },
    mkdirp,
    writeFile,
  });

  return {
    createOCIO: vi.fn(),
    createRuntime,
    setCreateBuiltinConfigError(error: Error | null) {
      createBuiltinConfigError = error;
    },
    setIncludeRawDisplayView(include: boolean) {
      includeRawDisplayView = include;
    },
    setOmittedRole(roleName: string | null) {
      omittedRoleName = roleName;
    },
    setMissingColorSpaceRole(roleName: string | null) {
      missingColorSpaceRoleName = roleName;
    },
    setIncludeMissingOptionalRole(include: boolean) {
      includeMissingOptionalRole = include;
    },
    setCreateColorSpaceProcessorImplementation(implementation: () => unknown) {
      createColorSpaceProcessorImplementation = implementation;
    },
    createColorSpaceProcessor,
    createDisplayViewProcessor,
    createConfigFromFile,
    mkdirp,
    writeFile,
  };
});

vi.mock('@/pwa/pwaLifecycle', () => ({
  refreshPwaCacheStatus: pwaMocks.refreshPwaCacheStatus,
}));

vi.mock('@bb-studio/ocio', () => ({
  createOCIO: ocioMocks.createOCIO,
}));

function OcioProbe() {
  const ocio = useOcio();
  return (
    <div>
      <div data-testid="ocio-status">
        {ocio.isInitialized
          ? `ready:${ocio.workingColorSpace}`
          : ocio.isLoading
            ? 'loading'
            : 'cold'}
      </div>
      <div data-testid="project-metadata">Project metadata</div>
      <div data-testid="viewer-output">Viewer output</div>
    </div>
  );
}

const DEFAULT_TEST_CONFIG = createBuiltinProjectColorConfigReference(
  ColorManagementDefaults.CONFIG,
);

const renderOcioProvider = () =>
  render(
    <PreferencesProvider>
      <OcioProvider activeConfig={DEFAULT_TEST_CONFIG}>
        <OcioProbe />
      </OcioProvider>
    </PreferencesProvider>,
  );

type OcioCreateOptions = {
  moduleOptions: {
    print: (message: unknown) => void;
    printErr: (message: unknown) => void;
  };
};

describe('ocioContext', () => {
  beforeEach(() => {
    localStorage.clear();
    colorManagementService.resetForTests();
    pwaMocks.refreshPwaCacheStatus.mockClear();
    ocioMocks.createOCIO.mockReset();
    ocioMocks.setCreateBuiltinConfigError(null);
    ocioMocks.setIncludeRawDisplayView(true);
    ocioMocks.setOmittedRole(null);
    ocioMocks.setMissingColorSpaceRole(null);
    ocioMocks.setIncludeMissingOptionalRole(false);
    ocioMocks.createColorSpaceProcessor.mockClear();
    ocioMocks.setCreateColorSpaceProcessorImplementation(() => {
      throw new Error('Processor unavailable');
    });
    ocioMocks.createDisplayViewProcessor.mockClear();
    ocioMocks.createConfigFromFile.mockClear();
    ocioMocks.mkdirp.mockClear();
    ocioMocks.writeFile.mockClear();
    ocioMocks.createOCIO.mockImplementation(async () => ocioMocks.createRuntime());
  });

  it('uses preferences only when project state is created, never as the runtime config source', () => {
    const projectConfig = createBuiltinProjectColorConfigReference('ocio://project-config');

    expect(getProjectRuntimeOcioConfig('project-1', projectConfig)).toBe(projectConfig);
    expect(getProjectRuntimeOcioConfig(null, projectConfig)).toEqual(
      createBuiltinProjectColorConfigReference(ColorManagementDefaults.CONFIG),
    );
  });

  it('initializes OCIO during startup and makes context available to children immediately', async () => {
    renderOcioProvider();

    // Children render immediately without a blocking splash screen.
    // The initial state may be 'cold' or 'loading' depending on React flush timing.
    expect(screen.getByTestId('project-metadata')).toBeTruthy();
    expect(
      ['cold', 'loading'].includes(screen.getByTestId('ocio-status').textContent ?? ''),
    ).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByTestId('ocio-status').textContent).toBe('ready:ACEScg');
    });

    expect(ocioMocks.createOCIO).toHaveBeenCalledOnce();
    expect(ocioMocks.createOCIO).toHaveBeenCalledWith({
      moduleOptions: {
        print: expect.any(Function),
        printErr: expect.any(Function),
      },
    });
    expect(pwaMocks.refreshPwaCacheStatus).toHaveBeenCalled();
  });

  it('keeps project children unmounted until their own config is active', async () => {
    const renderTree = (
      activeConfig: ReturnType<typeof createBuiltinProjectColorConfigReference>,
    ) => (
      <OcioProvider
        activeConfig={activeConfig}
        suspendChildrenUntilReady
        loadingFallback={<div data-testid="ocio-config-loading">Loading</div>}
      >
        <OcioProbe />
      </OcioProvider>
    );
    const { rerender } = render(renderTree(DEFAULT_TEST_CONFIG));

    expect(screen.getByTestId('ocio-config-loading')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId('ocio-status').textContent).toBe('ready:ACEScg');
    });

    const existingProjectConfig = createBuiltinProjectColorConfigReference(
      'ocio://existing-project-config',
    );
    rerender(renderTree(existingProjectConfig));

    expect(screen.getByTestId('ocio-config-loading')).toBeTruthy();
    expect(screen.queryByTestId('viewer-output')).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId('ocio-status').textContent).toBe('ready:ACEScg');
    });
    expect(colorManagementService.getSnapshot().configName).toBe(existingProjectConfig.uri);
  });

  it('filters noisy OCIO inactive-display info from the WASM console sink', async () => {
    renderOcioProvider();

    await waitFor(() => {
      expect(screen.getByTestId('ocio-status').textContent).toBe('ready:ACEScg');
    });

    const options = ocioMocks.createOCIO.mock.calls[0]?.[0] as OcioCreateOptions;
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      options.moduleOptions.printErr(
        "[OpenColorIO Info]: Inactive 'Rec.2100-HLG - Display' is neither a color space nor a named transform.",
      );
      options.moduleOptions.printErr('[OpenColorIO Warning]: Real warning');

      expect(consoleErrorSpy).toHaveBeenCalledOnce();
      expect(consoleErrorSpy).toHaveBeenCalledWith('[OpenColorIO Warning]: Real warning');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('does not normalize legacy application color-space aliases', async () => {
    renderOcioProvider();

    await waitFor(() => {
      expect(screen.getByTestId('ocio-status').textContent).toBe('ready:ACEScg');
    });

    expect(colorManagementService.resolveColorSpaceName('ACEScg')).toBe('ACEScg');
    expect(colorManagementService.resolveColorSpaceName('sRGB Encoded Rec.709 (sRGB)')).toBe(
      'sRGB Encoded Rec.709 (sRGB)',
    );
    expect(colorManagementService.resolveColorSpaceName('Linear')).toBe('Linear');
    expect(colorManagementService.resolveColorSpaceName('sRGB')).toBe('sRGB');
  });

  it('resolves native file rules through active config roles and color spaces', async () => {
    renderOcioProvider();

    await waitFor(() => {
      expect(screen.getByTestId('ocio-status').textContent).toBe('ready:ACEScg');
    });

    expect(colorManagementService.resolveFileRule('plate.exr')).toEqual({
      sourceColorSpace: 'ACES2065-1',
      ruleName: 'EXR',
      isDefaultRule: false,
      isData: false,
      detail: 'OCIO file rule: EXR',
    });
    expect(colorManagementService.resolveFileRule('plate.png').sourceColorSpace).toBe(
      'sRGB Encoded Rec.709 (sRGB)',
    );
  });

  it('resolves project role overrides before active config roles', async () => {
    renderOcioProvider();

    await waitFor(() => {
      expect(screen.getByTestId('ocio-status').textContent).toBe('ready:ACEScg');
    });

    const resolved = colorManagementService.resolveProjectColorManagement({
      ...createDefaultProjectColorManagement(),
      roleOverrides: {
        scene_linear: 'ACES2065-1',
        texture_paint: 'ACEScg',
      },
    });

    expect(resolved.workingColorSpace).toBe('ACES2065-1');
    expect(resolved.textureColorSpace).toBe('ACEScg');
    expect(resolved.colorPickingColorSpace).toBe('sRGB Encoded Rec.709 (sRGB)');
    expect(resolved.dataColorSpace).toBe('Raw');
  });

  it.each(['Raw', 'ACEScct', 'sRGB Display'])(
    'rejects %s as a project working-space override',
    async (override) => {
      renderOcioProvider();

      await waitFor(() => {
        expect(screen.getByTestId('ocio-status').textContent).toBe('ready:ACEScg');
      });

      expect(() =>
        colorManagementService.resolveProjectColorManagement({
          ...createDefaultProjectColorManagement(),
          workingSpace: {
            role: 'scene_linear',
            override,
          },
        }),
      ).toThrow(
        `Project working-space override "${override}" must be a scene-linear RGB color space.`,
      );
    },
  );

  it('rejects non-scene-linear scene_linear role overrides', async () => {
    renderOcioProvider();

    await waitFor(() => {
      expect(screen.getByTestId('ocio-status').textContent).toBe('ready:ACEScg');
    });

    expect(() =>
      colorManagementService.resolveProjectColorManagement({
        ...createDefaultProjectColorManagement(),
        roleOverrides: {
          scene_linear: 'ACEScct',
        },
      }),
    ).toThrow(
      'Project scene_linear role override "ACEScct" must be a scene-linear RGB color space.',
    );
  });

  it('reports unavailable optional roles without blocking startup', async () => {
    ocioMocks.setIncludeMissingOptionalRole(true);
    renderOcioProvider();

    await waitFor(() => {
      expect(screen.getByTestId('ocio-status').textContent).toBe('ready:ACEScg');
    });

    expect(colorManagementService.getSnapshot().optionalRoleIssues).toEqual([
      {
        name: 'compositing_log',
        colorSpace: 'Missing Log Space',
        message:
          'Optional OCIO role "compositing_log" references missing color space "Missing Log Space".',
      },
    ]);
  });

  it('rejects unresolved project color-management references without substituting defaults', async () => {
    renderOcioProvider();

    await waitFor(() => {
      expect(screen.getByTestId('ocio-status').textContent).toBe('ready:ACEScg');
    });

    expect(() =>
      colorManagementService.resolveProjectColorManagement({
        ...createDefaultProjectColorManagement(),
        viewer: {
          display: 'Missing Display',
          view: 'ACES 2.0 - SDR 100 nits (Rec.709)',
        },
      }),
    ).toThrow('Project display "Missing Display" is not defined by the active OCIO config.');

    expect(() =>
      colorManagementService.resolveProjectColorManagement({
        ...createDefaultProjectColorManagement(),
        viewer: {
          display: 'sRGB - Display',
          view: 'Missing View',
        },
      }),
    ).toThrow(
      'Project view "Missing View" is not defined for display "sRGB - Display" by the active OCIO config.',
    );

    expect(() =>
      colorManagementService.resolveProjectColorManagement({
        ...createDefaultProjectColorManagement(),
        config: {
          kind: 'external',
          uri: '/configs/show.ocio',
        },
      }),
    ).toThrow(
      `Project OCIO config "/configs/show.ocio" is not active. Active config: "${DEFAULT_TEST_CONFIG.uri}".`,
    );
  });

  it('resolves the project look only when it matches the selected OCIO view', async () => {
    renderOcioProvider();

    await waitFor(() => {
      expect(screen.getByTestId('ocio-status').textContent).toBe('ready:ACEScg');
    });

    const project = createDefaultProjectColorManagement();
    const resolved = colorManagementService.resolveProjectColorManagement({
      ...project,
      viewer: {
        ...project.viewer,
        look: 'Studio Look',
      },
    });

    expect(resolved.look).toBe('Studio Look');
    expect(() =>
      colorManagementService.resolveProjectColorManagement({
        ...project,
        viewer: {
          ...project.viewer,
          look: 'Missing Look',
        },
      }),
    ).toThrow(
      'Project look "Missing Look" does not match the OCIO looks configured for display "sRGB - Display" view "ACES 2.0 - SDR 100 nits (Rec.709)".',
    );
  });

  it('throws when a required OCIO color-space processor cannot be created', async () => {
    renderOcioProvider();

    await waitFor(() => {
      expect(screen.getByTestId('ocio-status').textContent).toBe('ready:ACEScg');
    });

    const rendererColorManagement = colorManagementService.getRendererColorManagement();
    expect(() => rendererColorManagement.getColorSpaceTransform('Camera Log', 'ACEScg')).toThrow(
      'Failed to create OCIO color-space transform Camera Log -> ACEScg',
    );
  });

  it('builds renderer color management from project roles and context', async () => {
    ocioMocks.setCreateColorSpaceProcessorImplementation(() => ({
      cacheId: 'project-context',
      isNoOp: false,
      isIdentity: false,
      dispose: vi.fn(),
      applyRGBF32: (rgb: Float32Array) => rgb,
    }));
    renderOcioProvider();

    await waitFor(() => {
      expect(screen.getByTestId('ocio-status').textContent).toBe('ready:ACEScg');
    });

    const project = {
      ...createDefaultProjectColorManagement(),
      workingSpace: { role: 'scene_linear' as const, override: 'ACES2065-1' },
      roleOverrides: {
        texture_paint: 'ACEScct',
        color_picking: 'sRGB Encoded Rec.709 (sRGB)',
        data: 'Raw',
      },
      context: { SHOT: 'A010' },
    };
    const rendererColorManagement =
      colorManagementService.getProjectRendererColorManagement(project);

    expect(rendererColorManagement).toMatchObject({
      workingColorSpace: 'ACES2065-1',
      textureColorSpace: 'ACEScct',
      colorPickingColorSpace: 'sRGB Encoded Rec.709 (sRGB)',
      dataColorSpace: 'Raw',
    });

    rendererColorManagement.transformRgb('ACEScct', 'ACES2065-1', [0.1, 0.2, 0.3]);
    expect(ocioMocks.createColorSpaceProcessor).toHaveBeenCalledWith('ACEScct', 'ACES2065-1', {
      optimization: 'lossless',
      context: { SHOT: 'A010' },
    });
  });

  it('loads an external config package into the OCIO virtual filesystem', async () => {
    const reference = { kind: 'external' as const, uri: 'project:///show/config.ocio' };
    registerExternalOcioConfigPackage(reference, {
      configPath: reference.uri,
      configRelativePath: 'show/config.ocio',
      files: [
        {
          relativePath: 'show/config.ocio',
          data: new TextEncoder().encode('ocio_profile_version: 2'),
        },
        {
          relativePath: 'show/luts/look.cube',
          data: new TextEncoder().encode('LUT_3D_SIZE 2'),
        },
      ],
    });

    try {
      const snapshot = await colorManagementService.initializeConfig(reference);

      expect(snapshot.isInitialized).toBe(true);
      expect(snapshot.configName).toBe(reference.uri);
      expect(ocioMocks.mkdirp).toHaveBeenCalledWith(
        expect.stringMatching(/^\/blackboard-external\/[^/]+\/show\/luts$/),
      );
      expect(ocioMocks.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/^\/blackboard-external\/[^/]+\/show\/config\.ocio$/),
        expect.any(Uint8Array),
      );
      expect(ocioMocks.createConfigFromFile).toHaveBeenCalledWith(
        expect.stringMatching(/^\/blackboard-external\/[^/]+\/show\/config\.ocio$/),
      );

      expect(() =>
        colorManagementService.resolveProjectColorManagement({
          ...createDefaultProjectColorManagement(),
          config: reference,
        }),
      ).not.toThrow();
    } finally {
      removeExternalOcioConfigPackage(reference.uri);
    }
  });

  it('serializes rapid config switches and leaves the latest reference active', async () => {
    const first = colorManagementService.initialize('first-config');
    const second = colorManagementService.initialize('second-config');

    await Promise.all([first, second]);

    expect(colorManagementService.getSnapshot().configName).toBe('ocio://second-config');
  });

  it('inspects another config without replacing the active renderer config', async () => {
    await colorManagementService.initialize('active-config');

    const inspected = await colorManagementService.inspectConfig({
      kind: 'builtin',
      id: 'inspected-config',
      uri: 'ocio://inspected-config',
    });

    expect(inspected.isInitialized).toBe(true);
    expect(inspected.configName).toBe('ocio://inspected-config');
    expect(inspected.defaultViewsByDisplay).toEqual({
      'sRGB - Display': 'ACES 2.0 - SDR 100 nits (Rec.709)',
    });
    expect(colorManagementService.getSnapshot().configName).toBe('ocio://active-config');
  });

  it('reuses a lossless CPU processor while preserving scene-linear float range', async () => {
    const applyRGBF32 = vi.fn(() => new Float32Array([-0.25, 1.5, 0.625]));
    ocioMocks.setCreateColorSpaceProcessorImplementation(() => ({
      cacheId: 'cpu-color',
      isNoOp: false,
      isIdentity: false,
      dispose: vi.fn(),
      applyRGBF32,
    }));
    renderOcioProvider();

    await waitFor(() => {
      expect(screen.getByTestId('ocio-status').textContent).toBe('ready:ACEScg');
    });

    expect(
      colorManagementService.transformRgb('sRGB Encoded Rec.709 (sRGB)', 'ACEScg', [0.1, 0.2, 0.3]),
    ).toEqual([-0.25, 1.5, 0.625]);
    colorManagementService.transformRgb('sRGB Encoded Rec.709 (sRGB)', 'ACEScg', [0.1, 0.2, 0.3]);
    colorManagementService.transformRgb('sRGB Encoded Rec.709 (sRGB)', 'ACEScg', [0.4, 0.5, 0.6]);
    colorManagementService.transformRgb(
      'sRGB Encoded Rec.709 (sRGB)',
      'ACES2065-1',
      [0.1, 0.2, 0.3],
    );
    await colorManagementService.initialize('replacement-config');
    colorManagementService.transformRgb('sRGB Encoded Rec.709 (sRGB)', 'ACEScg', [0.1, 0.2, 0.3]);

    expect(ocioMocks.createColorSpaceProcessor).toHaveBeenCalledTimes(3);
    expect(ocioMocks.createColorSpaceProcessor).toHaveBeenCalledWith(
      'sRGB Encoded Rec.709 (sRGB)',
      'ACEScg',
      { optimization: 'lossless' },
    );
    expect(ocioMocks.createColorSpaceProcessor).toHaveBeenCalledWith(
      'sRGB Encoded Rec.709 (sRGB)',
      'ACES2065-1',
      { optimization: 'lossless' },
    );
    expect(applyRGBF32).toHaveBeenCalledTimes(4);
  });

  it('reports and clears live processing caches without reloading the config', async () => {
    const dispose = vi.fn();
    ocioMocks.setCreateColorSpaceProcessorImplementation(() => ({
      cacheId: 'diagnostic-cache',
      isNoOp: false,
      isIdentity: false,
      dispose,
      applyRGBF32: (rgb: Float32Array) => rgb,
    }));
    renderOcioProvider();

    await waitFor(() => {
      expect(screen.getByTestId('ocio-status').textContent).toBe('ready:ACEScg');
    });

    colorManagementService.transformRgb('ACEScg', 'ACES2065-1', [0.1, 0.2, 0.3]);
    expect(colorManagementService.getDiagnostics()).toMatchObject({
      processorCacheEntries: 1,
      rgbTransformCacheEntries: 1,
      shaderProfile: 'GLSL ES 3.0',
    });

    colorManagementService.clearCaches();

    expect(dispose).toHaveBeenCalledOnce();
    expect(colorManagementService.getDiagnostics()).toMatchObject({
      processorCacheEntries: 0,
      shaderCacheEntries: 0,
      rgbTransformCacheEntries: 0,
    });
    expect(colorManagementService.getSnapshot().isInitialized).toBe(true);
  });

  it('records the latest CPU processor failure for diagnostics', async () => {
    ocioMocks.setCreateColorSpaceProcessorImplementation(() => {
      throw new Error('CPU processor construction failed.');
    });
    renderOcioProvider();

    await waitFor(() => {
      expect(screen.getByTestId('ocio-status').textContent).toBe('ready:ACEScg');
    });

    expect(() =>
      colorManagementService.transformRgb('ACEScg', 'ACES2065-1', [0.1, 0.2, 0.3]),
    ).toThrow('CPU processor construction failed.');
    expect(colorManagementService.getDiagnostics().latestFailure).toContain(
      'CPU processor construction failed.',
    );
  });

  it('scopes processor and value caches by canonical context and invalidates one context', async () => {
    const disposals: ReturnType<typeof vi.fn>[] = [];
    ocioMocks.setCreateColorSpaceProcessorImplementation(() => {
      const dispose = vi.fn();
      disposals.push(dispose);
      return {
        cacheId: `context-${disposals.length}`,
        isNoOp: false,
        isIdentity: false,
        dispose,
        applyRGBF32: (rgb: Float32Array) => rgb,
      };
    });
    renderOcioProvider();

    await waitFor(() => {
      expect(screen.getByTestId('ocio-status').textContent).toBe('ready:ACEScg');
    });

    const alphaContext = { SHOT: '010', LUT: 'alpha.spi1d' };
    const reorderedAlphaContext = { LUT: 'alpha.spi1d', SHOT: '010' };
    const betaContext = { SHOT: '020', LUT: 'beta.spi1d' };
    const color = [0.1, 0.2, 0.3] as const;

    colorManagementService.transformRgb('ACEScg', 'ACES2065-1', color, alphaContext);
    colorManagementService.transformRgb('ACEScg', 'ACES2065-1', color, reorderedAlphaContext);
    colorManagementService.transformRgb('ACEScg', 'ACES2065-1', color, betaContext);

    expect(ocioMocks.createColorSpaceProcessor).toHaveBeenCalledTimes(2);
    expect(ocioMocks.createColorSpaceProcessor).toHaveBeenCalledWith('ACEScg', 'ACES2065-1', {
      optimization: 'lossless',
      context: alphaContext,
    });

    colorManagementService.invalidateContext(alphaContext);
    expect(disposals[0]).toHaveBeenCalledOnce();
    expect(disposals[1]).not.toHaveBeenCalled();

    colorManagementService.transformRgb('ACEScg', 'ACES2065-1', color, alphaContext);
    colorManagementService.transformRgb('ACEScg', 'ACES2065-1', color, betaContext);
    expect(ocioMocks.createColorSpaceProcessor).toHaveBeenCalledTimes(3);
  });

  it('scopes generated GPU shaders by canonical context and invalidates only that context', async () => {
    const disposals: ReturnType<typeof vi.fn>[] = [];
    const getGpuShaderInfo = vi.fn(
      (options: { language: string; functionName: string; resourcePrefix: string }) => ({
        cacheId: `shader-${disposals.length}`,
        language: options.language,
        functionName: options.functionName,
        shaderText: `vec4 ${options.functionName}(vec4 color) { return color; }`,
        textures: [],
        uniforms: [],
      }),
    );
    ocioMocks.setCreateColorSpaceProcessorImplementation(() => {
      const dispose = vi.fn();
      disposals.push(dispose);
      return {
        cacheId: `gpu-context-${disposals.length}`,
        isNoOp: false,
        isIdentity: false,
        dispose,
        applyRGBF32: (rgb: Float32Array) => rgb,
        getGpuShaderInfo,
      };
    });
    renderOcioProvider();

    await waitFor(() => {
      expect(screen.getByTestId('ocio-status').textContent).toBe('ready:ACEScg');
    });

    const alphaContext = { SHOT: '010', LUT: 'alpha.spi1d' };
    const reorderedAlphaContext = { LUT: 'alpha.spi1d', SHOT: '010' };
    const betaContext = { SHOT: '020', LUT: 'beta.spi1d' };
    const alphaRenderer = colorManagementService.getRendererColorManagement(alphaContext);
    const reorderedAlphaRenderer =
      colorManagementService.getRendererColorManagement(reorderedAlphaContext);
    const betaRenderer = colorManagementService.getRendererColorManagement(betaContext);

    alphaRenderer.getColorSpaceTransform('ACEScg', 'ACES2065-1');
    reorderedAlphaRenderer.getColorSpaceTransform('ACEScg', 'ACES2065-1');
    betaRenderer.getColorSpaceTransform('ACEScg', 'ACES2065-1');

    expect(ocioMocks.createColorSpaceProcessor).toHaveBeenCalledTimes(2);
    expect(getGpuShaderInfo).toHaveBeenCalledTimes(2);
    expect(colorManagementService.getDiagnostics().shaderCacheEntries).toBe(2);

    colorManagementService.invalidateContext(alphaContext);
    expect(disposals[0]).toHaveBeenCalledOnce();
    expect(disposals[1]).not.toHaveBeenCalled();
    expect(colorManagementService.getDiagnostics().shaderCacheEntries).toBe(1);

    alphaRenderer.getColorSpaceTransform('ACEScg', 'ACES2065-1');
    betaRenderer.getColorSpaceTransform('ACEScg', 'ACES2065-1');
    expect(ocioMocks.createColorSpaceProcessor).toHaveBeenCalledTimes(3);
    expect(getGpuShaderInfo).toHaveBeenCalledTimes(3);
  });

  it('keeps Raw display behavior only when returned by the active config', async () => {
    renderOcioProvider();

    await waitFor(() => {
      expect(screen.getByTestId('ocio-status').textContent).toBe('ready:ACEScg');
    });

    const rendererColorManagement = colorManagementService.getRendererColorManagement();
    expect(rendererColorManagement.getDisplayViewTransform('ACEScg', 'sRGB - Display', 'Raw')).toBe(
      null,
    );
    expect(ocioMocks.createDisplayViewProcessor).not.toHaveBeenCalled();
  });

  it('does not treat an unavailable Raw view as an application fallback', async () => {
    ocioMocks.setIncludeRawDisplayView(false);
    renderOcioProvider();

    await waitFor(() => {
      expect(screen.getByTestId('ocio-status').textContent).toBe('ready:ACEScg');
    });

    const rendererColorManagement = colorManagementService.getRendererColorManagement();
    expect(() =>
      rendererColorManagement.getDisplayViewTransform('ACEScg', 'sRGB - Display', 'Raw'),
    ).toThrow('Failed to create OCIO display/view transform ACEScg -> sRGB - Display/Raw');
    expect(ocioMocks.createDisplayViewProcessor).toHaveBeenCalledWith({
      source: 'ACEScg',
      display: 'sRGB - Display',
      view: 'Raw',
      optimization: 'lossless',
    });
  });

  it('keeps all UI mounted when OCIO startup fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    ocioMocks.createOCIO.mockRejectedValueOnce(new Error('WASM runtime missing'));

    try {
      renderOcioProvider();

      await waitFor(() => {
        expect(screen.getByTestId('project-metadata')).toBeTruthy();
      });

      expect(screen.getByTestId('ocio-status').textContent).toBe('cold');
      // Viewer output renders unconditionally — no gate blocks it
      expect(screen.getByTestId('viewer-output')).toBeTruthy();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('keeps all UI mounted when built-in config creation fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    ocioMocks.setCreateBuiltinConfigError(new Error('Config creation failed'));

    try {
      renderOcioProvider();

      await waitFor(() => {
        expect(screen.getByTestId('project-metadata')).toBeTruthy();
      });

      expect(screen.getByTestId('ocio-status').textContent).toBe('cold');
      // Viewer output renders unconditionally
      expect(screen.getByTestId('viewer-output')).toBeTruthy();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('keeps all UI mounted when a required OCIO role is missing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    ocioMocks.setOmittedRole('scene_linear');

    try {
      renderOcioProvider();

      await waitFor(() => {
        expect(screen.getByTestId('project-metadata')).toBeTruthy();
      });

      expect(screen.getByTestId('ocio-status').textContent).toBe('cold');
      // All UI renders unconditionally — no gate blocks the viewer
      expect(screen.getByTestId('viewer-output')).toBeTruthy();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('keeps all UI mounted when a required OCIO role references a missing color space', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    ocioMocks.setMissingColorSpaceRole('texture_paint');

    try {
      renderOcioProvider();

      await waitFor(() => {
        expect(screen.getByTestId('project-metadata')).toBeTruthy();
      });

      expect(screen.getByTestId('ocio-status').textContent).toBe('cold');
      // All UI renders unconditionally — no gate blocks the viewer
      expect(screen.getByTestId('viewer-output')).toBeTruthy();
    } finally {
      consoleError.mockRestore();
    }
  });
});
