import type { RendererColorManagement, RendererOcioShaderInfo } from '@blackboard/renderer';
import type {
  ColorConfigReference,
  ProjectColorManagement,
  RequiredOcioRole,
} from '@blackboard/types';
import type {
  Config,
  DisplayViewProcessorOptions,
  GpuShaderInfo,
  OCIO,
  Processor,
  ViewInfo,
} from '@bb-studio/ocio';
import type {
  ColorManagementRuntimeSnapshot,
  ColorManagementService,
  ColorManagementServiceDiagnostics,
  DisplayViewInfo,
  ResolvedOcioFileRule,
  ResolvedProjectColorManagement,
} from './types';
import { ColorManagementDefaults } from './constants';
import { normalizeBuiltinConfigName } from './config';
import {
  getUnavailableOptionalRoles,
  resolveCanonicalColorSpaceName,
  resolveRequiredColorRoles,
} from './roles';
import { assertProjectColorManagement } from './project';
import { assertSceneLinearWorkingSpaceCandidate } from './workingSpace';
import { loadExternalOcioConfigPackage } from './externalConfig';

type OcioModule = typeof import('@bb-studio/ocio');

let ocioModulePromise: Promise<OcioModule> | null = null;

const loadOcioModule = (): Promise<OcioModule> => {
  ocioModulePromise ??= import('@bb-studio/ocio');
  return ocioModulePromise;
};

const INACTIVE_COLOR_REFERENCE_INFO_PATTERN =
  /^\[OpenColorIO Info\]: Inactive '[^']+' is neither a color space nor a named transform\.$/;

export const shouldSuppressOcioWasmLogMessage = (message: string): boolean =>
  INACTIVE_COLOR_REFERENCE_INFO_PATTERN.test(message.trim());

const createFilteredOcioLogSink =
  (sink?: (message: string) => void) =>
  (message: unknown): void => {
    const text = typeof message === 'string' ? message : String(message);
    if (shouldSuppressOcioWasmLogMessage(text)) return;
    sink?.(text);
  };

const createOcioModuleOptions = (): Record<string, unknown> => ({
  print: createFilteredOcioLogSink(),
  printErr: createFilteredOcioLogSink((message) => console.error(message)),
});

type ShaderKind = 'display' | 'colorspace';
const MAX_RGB_TRANSFORM_CACHE_ENTRIES = 2048;
type OcioContextVariables = Readonly<Record<string, string>>;

interface CachedShaderRequest {
  kind: ShaderKind;
  key: string;
  functionPrefix: string;
  resourcePrefix: string;
  createProcessor: () => Processor;
  describeFailure: () => string;
}

const emptySnapshot = (): ColorManagementRuntimeSnapshot => ({
  isInitialized: false,
  isLoading: false,
  version: '',
  versionHex: 0,
  configName: ColorManagementDefaults.CONFIG,
  configVersion: null,
  error: null,
  errorDetail: null,
  builtinConfigs: [],
  colorSpaces: [],
  roles: [],
  optionalRoleIssues: [],
  displays: [],
  viewsByDisplay: {},
  defaultViewsByDisplay: {},
  defaultDisplay: ColorManagementDefaults.DISPLAY,
  defaultView: ColorManagementDefaults.VIEW,
  workingColorSpace: ColorManagementDefaults.WORKING_SPACE,
  textureColorSpace: ColorManagementDefaults.TEXTURE_SPACE,
  colorPickingColorSpace: ColorManagementDefaults.COLOR_PICKING_SPACE,
  dataColorSpace: ColorManagementDefaults.DATA_SPACE,
});

const hashKey = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const normalizeContext = (context: OcioContextVariables = {}): Record<string, string> => {
  const entries = Object.entries(context);
  for (const [name, value] of entries) {
    if (!name.trim() || typeof value !== 'string') {
      throw new Error('OCIO context variables require non-empty names and string values.');
    }
  }
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
};

const resolveOptionalRoleColorSpace = (
  roleName: string,
  roles: readonly { name: string; colorSpace: string }[],
  colorSpaces: readonly { name: string; canonicalName?: string | null }[],
): string | undefined => {
  const role = roles.find((candidate) => candidate.name === roleName);
  if (!role) return undefined;
  return resolveCanonicalColorSpaceName(colorSpaces, role.colorSpace) ?? undefined;
};

const toRendererShaderInfo = (
  shaderInfo: GpuShaderInfo,
  kind: ShaderKind,
  key: string,
): RendererOcioShaderInfo => ({
  kind,
  key,
  shaderText: shaderInfo.shaderText,
  functionName: shaderInfo.functionName,
  language: shaderInfo.language,
  cacheId: shaderInfo.cacheId || key,
  textures: shaderInfo.textures,
  uniforms: shaderInfo.uniforms,
});

class OcioColorManagementService implements ColorManagementService {
  private ocio: OCIO | null = null;
  private ocioPromise: Promise<OCIO> | null = null;
  private config: Config | null = null;
  private snapshot = emptySnapshot();
  private initPromise: Promise<ColorManagementRuntimeSnapshot> | null = null;
  private initializingConfigName: string | null = null;
  private processorCache = new Map<string, Processor>();
  private shaderCache = new Map<string, RendererOcioShaderInfo | null>();
  private rgbTransformCache = new Map<string, [number, number, number]>();
  private latestFailure: string | null = null;

  public async initialize(
    configName: string = ColorManagementDefaults.CONFIG,
  ): Promise<ColorManagementRuntimeSnapshot> {
    return this.initializeConfig({
      kind: 'builtin',
      id: configName,
      uri: normalizeBuiltinConfigName(configName),
    });
  }

  public async initializeConfig(
    reference: ColorConfigReference,
  ): Promise<ColorManagementRuntimeSnapshot> {
    const normalizedConfigName =
      reference.kind === 'builtin' ? normalizeBuiltinConfigName(reference.uri) : reference.uri;
    if (
      this.snapshot.isInitialized &&
      this.snapshot.configName === normalizedConfigName &&
      !this.snapshot.error
    ) {
      return this.snapshot;
    }

    if (this.initPromise) {
      if (this.initializingConfigName === normalizedConfigName) {
        return this.initPromise;
      }
      await this.initPromise;
      return this.initializeConfig(reference);
    }

    this.snapshot = {
      ...emptySnapshot(),
      builtinConfigs: this.snapshot.builtinConfigs,
      isInitialized: false,
      isLoading: true,
      configName: normalizedConfigName,
      error: null,
      errorDetail: null,
    };

    const normalizedReference =
      reference.kind === 'builtin' ? { ...reference, uri: normalizedConfigName } : { ...reference };
    this.initializingConfigName = normalizedConfigName;
    this.initPromise = this.load(normalizedReference).finally(() => {
      this.initPromise = null;
      this.initializingConfigName = null;
    });

    return this.initPromise;
  }

  public async inspectConfig(
    reference: ColorConfigReference,
  ): Promise<ColorManagementRuntimeSnapshot> {
    const configName =
      reference.kind === 'builtin' ? normalizeBuiltinConfigName(reference.uri) : reference.uri;

    if (this.initPromise) await this.initPromise;
    if (
      this.snapshot.isInitialized &&
      this.snapshot.configName === configName &&
      !this.snapshot.error
    ) {
      return this.snapshot;
    }

    let config: Config | null = null;
    try {
      await this.ensureOcio();
      config =
        reference.kind === 'builtin'
          ? this.ocio!.createBuiltinConfig(configName)
          : await this.createExternalConfig(reference);
      config.validate();
      return this.createRuntimeSnapshot(configName, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      return {
        ...emptySnapshot(),
        configName,
        error: message,
        errorDetail: detail,
      };
    } finally {
      config?.dispose();
    }
  }

  public getSnapshot(): ColorManagementRuntimeSnapshot {
    return this.snapshot;
  }

  public getDiagnostics(): ColorManagementServiceDiagnostics {
    return {
      processorCacheEntries: this.processorCache.size,
      shaderCacheEntries: this.shaderCache.size,
      rgbTransformCacheEntries: this.rgbTransformCache.size,
      shaderProfile: 'GLSL ES 3.0',
      latestFailure: this.latestFailure,
    };
  }

  public clearCaches(): void {
    this.processorCache.forEach((processor) => processor.dispose());
    this.processorCache.clear();
    this.shaderCache.clear();
    this.rgbTransformCache.clear();
  }

  public resetForTests(): void {
    this.disposeConfig();
    this.ocio = null;
    this.ocioPromise = null;
    this.initPromise = null;
    this.initializingConfigName = null;
    this.snapshot = emptySnapshot();
    this.latestFailure = null;
  }

  public getRendererColorManagement(context: OcioContextVariables = {}): RendererColorManagement {
    const contextSnapshot = normalizeContext(context);
    return {
      getColorSpaceTransform: (source, destination) =>
        this.getColorSpaceShader(source, destination, contextSnapshot),
      getDisplayViewTransform: (source, display, view, look) =>
        this.getDisplayViewShader(source, display, view, look, contextSnapshot),
      transformRgb: (source, destination, color) =>
        this.transformRgb(source, destination, color, contextSnapshot),
      resolveColorSpaceName: (value) => this.resolveColorSpaceName(value),
      defaultDisplay: this.snapshot.defaultDisplay,
      defaultView: this.snapshot.defaultView,
      workingColorSpace: this.snapshot.workingColorSpace,
      textureColorSpace: this.snapshot.textureColorSpace,
      colorPickingColorSpace: this.snapshot.colorPickingColorSpace,
      dataColorSpace: this.snapshot.dataColorSpace,
      logColorSpace: this.snapshot.logColorSpace,
    };
  }

  public getProjectRendererColorManagement(
    project: ProjectColorManagement,
  ): RendererColorManagement {
    const resolved = this.resolveProjectColorManagement(project);
    const contextSnapshot = normalizeContext(resolved.context);
    return {
      getColorSpaceTransform: (source, destination) =>
        this.getColorSpaceShader(source, destination, contextSnapshot),
      getDisplayViewTransform: (source, display, view, look) =>
        this.getDisplayViewShader(source, display, view, look, contextSnapshot),
      transformRgb: (source, destination, color) =>
        this.transformRgb(source, destination, color, contextSnapshot),
      resolveColorSpaceName: (value) => this.resolveColorSpaceName(value),
      defaultDisplay: resolved.display,
      defaultView: resolved.view,
      workingColorSpace: resolved.workingColorSpace,
      textureColorSpace: resolved.textureColorSpace,
      colorPickingColorSpace: resolved.colorPickingColorSpace,
      dataColorSpace: resolved.dataColorSpace,
      logColorSpace: resolved.logColorSpace,
    };
  }

  public resolveProjectColorManagement(
    project: ProjectColorManagement,
  ): ResolvedProjectColorManagement {
    const resolvedProject = assertProjectColorManagement(project);
    const projectConfigName =
      resolvedProject.config.kind === 'builtin'
        ? normalizeBuiltinConfigName(resolvedProject.config.uri)
        : resolvedProject.config.uri;
    if (projectConfigName !== this.snapshot.configName) {
      throw new Error(
        `Project OCIO config "${projectConfigName}" is not active. Active config: "${this.snapshot.configName}".`,
      );
    }

    const roleOverrides: Partial<Record<RequiredOcioRole, string>> = {
      ...resolvedProject.roleOverrides,
    };
    const workingSpaceOverride = resolvedProject.workingSpace.override?.trim();
    if (workingSpaceOverride) {
      roleOverrides.scene_linear = assertSceneLinearWorkingSpaceCandidate(
        this.snapshot.colorSpaces,
        workingSpaceOverride,
        'Project working-space override',
      );
    } else if (roleOverrides.scene_linear) {
      roleOverrides.scene_linear = assertSceneLinearWorkingSpaceCandidate(
        this.snapshot.colorSpaces,
        roleOverrides.scene_linear,
        'Project scene_linear role override',
      );
    }

    const resolvedRoles = resolveRequiredColorRoles(
      this.snapshot.roles,
      this.snapshot.colorSpaces,
      roleOverrides,
    );
    const logColorSpace = resolveOptionalRoleColorSpace(
      'compositing_log',
      this.snapshot.roles,
      this.snapshot.colorSpaces,
    );
    const display = resolvedProject.viewer.display.trim();
    if (!this.snapshot.displays.includes(display)) {
      throw new Error(`Project display "${display}" is not defined by the active OCIO config.`);
    }

    const view = resolvedProject.viewer.view.trim();
    const views = this.snapshot.viewsByDisplay[display] ?? [];
    const viewInfo = views.find((candidate) => candidate.name === view);
    if (!viewInfo) {
      throw new Error(
        `Project view "${view}" is not defined for display "${display}" by the active OCIO config.`,
      );
    }
    const look = resolvedProject.viewer.look?.trim();
    this.assertDisplayViewLook(display, view, look, viewInfo);

    return {
      project: resolvedProject,
      config: resolvedProject.config,
      workingColorSpace: resolvedRoles.sceneLinear,
      textureColorSpace: resolvedRoles.texturePaint,
      colorPickingColorSpace: resolvedRoles.colorPicking,
      dataColorSpace: resolvedRoles.data,
      ...(logColorSpace ? { logColorSpace } : {}),
      display,
      view,
      ...(look ? { look } : {}),
      context: { ...(resolvedProject.context ?? {}) },
    };
  }

  public resolveColorSpaceName(value: string | undefined | null): string {
    const trimmed = value?.trim();
    if (!trimmed) return this.snapshot.textureColorSpace;
    return trimmed;
  }

  public resolveConfiguredColorSpaceName(value: string): string {
    const trimmed = value.trim();
    const roleColorSpace = this.snapshot.roles.find((role) => role.name === trimmed)?.colorSpace;
    const canonicalName = resolveCanonicalColorSpaceName(
      this.snapshot.colorSpaces,
      roleColorSpace || trimmed,
    );
    if (!canonicalName) {
      throw new Error(
        `OCIO color-space reference "${trimmed}" is not defined by the active config.`,
      );
    }
    return canonicalName;
  }

  public resolveFileRule(filePath: string): ResolvedOcioFileRule {
    const trimmedPath = filePath.trim();
    if (!trimmedPath) {
      throw new Error('OCIO file-rule resolution requires a file path.');
    }

    const match = this.config.matchFileRule(trimmedPath);
    if (!match) {
      throw new Error(`No OCIO file rule matched "${trimmedPath}".`);
    }

    const sourceColorSpace = this.resolveConfiguredColorSpaceName(match.colorSpace);
    const colorSpace = this.snapshot.colorSpaces.find(
      (candidate) =>
        candidate.name === sourceColorSpace || candidate.canonicalName === sourceColorSpace,
    );
    return {
      sourceColorSpace,
      ruleName: match.ruleName,
      isDefaultRule: match.isDefaultRule,
      isData: colorSpace?.isData ?? false,
      detail: `OCIO file rule: ${match.ruleName}`,
    };
  }

  public transformRgb(
    source: string,
    destination: string,
    color: readonly [number, number, number],
    context: OcioContextVariables = {},
  ): [number, number, number] {
    if (!color.every(Number.isFinite)) {
      throw new Error('CPU color transforms require three finite RGB values.');
    }

    const src = this.resolveColorSpaceName(source);
    const dst = this.resolveColorSpaceName(destination);
    if (src === dst) return [...color];
    if (src === this.snapshot.dataColorSpace || dst === this.snapshot.dataColorSpace) {
      throw new Error('CPU RGB transforms cannot use the OCIO data color space.');
    }

    const contextSnapshot = normalizeContext(context);
    const scope = this.getCacheScope(contextSnapshot);
    const processorKey = `${scope}|cs:${src}->${dst}`;
    const colorKey = `${processorKey}:${color[0]},${color[1]},${color[2]}`;
    const cached = this.rgbTransformCache.get(colorKey);
    if (cached) {
      this.rgbTransformCache.delete(colorKey);
      this.rgbTransformCache.set(colorKey, cached);
      return [...cached];
    }

    try {
      const processor = this.getProcessor(processorKey, () =>
        this.config!.createColorSpaceProcessor(src, dst, {
          optimization: 'lossless',
          ...(Object.keys(contextSnapshot).length > 0 ? { context: contextSnapshot } : {}),
        }),
      );
      const transformed =
        processor.isNoOp || processor.isIdentity
          ? color
          : processor.applyRGBF32(new Float32Array(color));
      const result: [number, number, number] = [transformed[0], transformed[1], transformed[2]];
      this.rgbTransformCache.set(colorKey, result);
      if (this.rgbTransformCache.size > MAX_RGB_TRANSFORM_CACHE_ENTRIES) {
        const oldestKey = this.rgbTransformCache.keys().next().value;
        if (oldestKey) this.rgbTransformCache.delete(oldestKey);
      }
      return [...result];
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  public invalidateContext(context: OcioContextVariables): void {
    const prefix = `${this.getCacheScope(normalizeContext(context))}|`;
    for (const [key, processor] of this.processorCache) {
      if (!key.startsWith(prefix)) continue;
      processor.dispose();
      this.processorCache.delete(key);
    }
    for (const key of this.shaderCache.keys()) {
      if (key.startsWith(prefix)) this.shaderCache.delete(key);
    }
    for (const key of this.rgbTransformCache.keys()) {
      if (key.startsWith(prefix)) this.rgbTransformCache.delete(key);
    }
  }

  public getDefaultView(display: string | undefined | null, colorSpace?: string): string {
    if (!this.config) return this.snapshot.defaultView;
    const resolvedDisplay = display || this.snapshot.defaultDisplay;
    const resolvedColorSpace = colorSpace?.trim()
      ? this.resolveColorSpaceName(colorSpace)
      : this.snapshot.workingColorSpace;
    try {
      return (
        this.config.getDefaultView(resolvedDisplay, resolvedColorSpace) ||
        this.config.getDefaultView(resolvedDisplay) ||
        this.snapshot.viewsByDisplay[resolvedDisplay]?.[0]?.name ||
        this.snapshot.defaultView
      );
    } catch {
      return this.snapshot.viewsByDisplay[resolvedDisplay]?.[0]?.name || this.snapshot.defaultView;
    }
  }

  public getViews(display: string | undefined | null): DisplayViewInfo[] {
    const resolvedDisplay = display || this.snapshot.defaultDisplay;
    return this.snapshot.viewsByDisplay[resolvedDisplay] ?? [];
  }

  public getColorSpaceShader(
    source: string | undefined | null,
    destination: string | undefined | null,
    context: OcioContextVariables = {},
  ): RendererOcioShaderInfo | null {
    const src = this.resolveColorSpaceName(source);
    const dst = this.resolveColorSpaceName(destination || this.snapshot.workingColorSpace);
    if (
      !src ||
      !dst ||
      src === dst ||
      src === this.snapshot.dataColorSpace ||
      dst === this.snapshot.dataColorSpace
    ) {
      return null;
    }

    const contextSnapshot = normalizeContext(context);
    const key = `${this.getCacheScope(contextSnapshot)}|cs:${src}->${dst}`;
    return this.getCachedShader({
      kind: 'colorspace',
      key,
      functionPrefix: 'OCIOColorTransform',
      resourcePrefix: 'ocio_cs',
      createProcessor: () =>
        this.config!.createColorSpaceProcessor(src, dst, {
          optimization: 'lossless',
          ...(Object.keys(contextSnapshot).length > 0 ? { context: contextSnapshot } : {}),
        }),
      describeFailure: () => `Failed to create OCIO color-space transform ${src} -> ${dst}`,
    });
  }

  public getDisplayViewShader(
    source: string | undefined | null,
    display: string | undefined | null,
    view: string | undefined | null,
    look?: string,
    context: OcioContextVariables = {},
  ): RendererOcioShaderInfo | null {
    const src = this.resolveColorSpaceName(source || this.snapshot.workingColorSpace);
    const resolvedDisplay = display || this.snapshot.defaultDisplay;
    const resolvedView = view || this.getDefaultView(resolvedDisplay, src);
    if (!src || !resolvedDisplay || !resolvedView) return null;
    this.assertDisplayViewLook(resolvedDisplay, resolvedView, look);
    if (this.isDataDisplayView(resolvedDisplay, resolvedView)) return null;

    const resolvedLook = look?.trim();
    const contextSnapshot = normalizeContext(context);
    const key = `${this.getCacheScope(contextSnapshot)}|display:${src}->${resolvedDisplay}/${resolvedView}${resolvedLook ? `#${resolvedLook}` : ''}`;
    return this.getCachedShader({
      kind: 'display',
      key,
      functionPrefix: 'OCIODisplay',
      resourcePrefix: 'ocio_view',
      createProcessor: () =>
        this.config!.createDisplayViewProcessor({
          source: src,
          display: resolvedDisplay,
          view: resolvedView,
          optimization: 'lossless',
          ...(Object.keys(contextSnapshot).length > 0 ? { context: contextSnapshot } : {}),
        } satisfies DisplayViewProcessorOptions),
      describeFailure: () =>
        `Failed to create OCIO display/view transform ${src} -> ${resolvedDisplay}/${resolvedView}`,
    });
  }

  private async createExternalConfig(
    reference: Extract<ColorConfigReference, { kind: 'external' }>,
  ): Promise<Config> {
    if (!this.ocio) {
      throw new Error('OpenColorIO is not initialized.');
    }
    const source = await loadExternalOcioConfigPackage(reference);
    const workingDir = `/blackboard-external/${hashKey(reference.uri)}`;

    this.ocio.mkdirp(workingDir);
    source.files.forEach((file) => {
      const segments = file.relativePath.split('/');
      if (segments.length > 1) {
        this.ocio!.mkdirp(`${workingDir}/${segments.slice(0, -1).join('/')}`);
      }
      this.ocio!.writeFile(`${workingDir}/${file.relativePath}`, file.data);
    });

    return this.ocio.createConfigFromFile(`${workingDir}/${source.configRelativePath}`);
  }

  private async load(reference: ColorConfigReference): Promise<ColorManagementRuntimeSnapshot> {
    const configName =
      reference.kind === 'builtin' ? normalizeBuiltinConfigName(reference.uri) : reference.uri;
    try {
      this.disposeConfig();
      await this.ensureOcio();
      const config =
        reference.kind === 'builtin'
          ? this.ocio!.createBuiltinConfig(configName)
          : await this.createExternalConfig(reference);
      this.config = config;
      config.validate();
      this.snapshot = this.createRuntimeSnapshot(configName, config);
      this.latestFailure = null;
      return this.snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      this.latestFailure = detail;
      console.error('Failed to initialize OpenColorIO:', error);
      this.disposeConfig();
      this.snapshot = {
        ...emptySnapshot(),
        isLoading: false,
        configName,
        error: message,
        errorDetail: detail,
      };
      return this.snapshot;
    }
  }

  private async ensureOcio(): Promise<OCIO> {
    if (this.ocio) return this.ocio;
    this.ocioPromise ??= loadOcioModule().then(async ({ createOCIO }) =>
      createOCIO({
        moduleOptions: createOcioModuleOptions(),
      }),
    );
    try {
      this.ocio = await this.ocioPromise;
      return this.ocio;
    } finally {
      this.ocioPromise = null;
    }
  }

  private createRuntimeSnapshot(
    configName: string,
    config: Config,
  ): ColorManagementRuntimeSnapshot {
    if (!this.ocio) {
      throw new Error('OpenColorIO is not initialized.');
    }

    const colorSpaces = config.listColorSpaces();
    const roles = config.listRoles();
    const optionalRoleIssues = getUnavailableOptionalRoles(roles, colorSpaces);
    const logColorSpace = resolveOptionalRoleColorSpace('compositing_log', roles, colorSpaces);
    const displays = config.listDisplays();
    const viewsByDisplay = Object.fromEntries(
      displays.map((display) => [display, config.listViews(display)]),
    );
    const resolvedRoles = resolveRequiredColorRoles(roles, colorSpaces);
    const defaultViewsByDisplay = Object.fromEntries(
      displays.map((display) => {
        const view =
          config.getDefaultView(display, resolvedRoles.sceneLinear) ||
          config.getDefaultView(display) ||
          viewsByDisplay[display]?.[0]?.name;
        if (!view) {
          throw new Error(`OCIO display "${display}" does not define a view.`);
        }
        return [display, view];
      }),
    );
    const defaultDisplay = config.getDefaultDisplay() || displays[0];
    if (!defaultDisplay) {
      throw new Error(`OCIO config "${configName}" does not define a display.`);
    }
    const defaultView = defaultViewsByDisplay[defaultDisplay];
    if (!defaultView) {
      throw new Error(`OCIO default display "${defaultDisplay}" does not define a view.`);
    }

    return {
      isInitialized: true,
      isLoading: false,
      version: this.ocio.version,
      versionHex: this.ocio.versionHex,
      configName,
      configVersion: config.version,
      error: null,
      errorDetail: null,
      builtinConfigs: this.ocio.listBuiltinConfigs(),
      colorSpaces,
      roles,
      optionalRoleIssues,
      displays,
      viewsByDisplay,
      defaultViewsByDisplay,
      defaultDisplay,
      defaultView,
      workingColorSpace: resolvedRoles.sceneLinear,
      textureColorSpace: resolvedRoles.texturePaint,
      colorPickingColorSpace: resolvedRoles.colorPicking,
      dataColorSpace: resolvedRoles.data,
      ...(logColorSpace ? { logColorSpace } : {}),
    };
  }

  private getProcessor(key: string, factory: () => Processor): Processor {
    const existing = this.processorCache.get(key);
    if (existing) return existing;
    try {
      const processor = factory();
      this.processorCache.set(key, processor);
      return processor;
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  private getCacheScope(context: OcioContextVariables): string {
    return JSON.stringify({
      config: this.snapshot.configName,
      version: this.snapshot.configVersion,
      context,
    });
  }

  private getCachedShader(request: CachedShaderRequest): RendererOcioShaderInfo | null {
    if (this.shaderCache.has(request.key)) {
      return this.shaderCache.get(request.key) ?? null;
    }

    try {
      const processor = this.getProcessor(request.key, request.createProcessor);
      if (processor.isNoOp || processor.isIdentity) {
        this.shaderCache.set(request.key, null);
        return null;
      }

      const shaderKey = hashKey(request.key);
      const shaderInfo = processor.getGpuShaderInfo({
        language: 'glsl_es_3.0',
        functionName: `${request.functionPrefix}_${shaderKey}`,
        resourcePrefix: `${request.resourcePrefix}_${shaderKey}`,
        allowTexture1D: false,
      });
      const rendererInfo = toRendererShaderInfo(shaderInfo, request.kind, request.key);
      this.shaderCache.set(request.key, rendererInfo);
      return rendererInfo;
    } catch (error) {
      this.recordFailure(error);
      throw new Error(
        `${request.describeFailure()}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  private getConfiguredView(display: string, view: string): ViewInfo | null {
    const snapshotView = this.snapshot.viewsByDisplay[display]?.find(
      (candidate) => candidate.name === view,
    );
    if (snapshotView) return snapshotView as ViewInfo;
    if (!this.config) return null;

    try {
      return this.config.getView(display, view);
    } catch {
      return null;
    }
  }

  private getConfiguredColorSpaceName(colorSpaceName: string | undefined | null): string | null {
    return resolveCanonicalColorSpaceName(this.snapshot.colorSpaces, colorSpaceName);
  }

  private assertDisplayViewLook(
    display: string,
    view: string,
    look: string | undefined,
    viewInfo: Pick<ViewInfo, 'looks'> | null = this.getConfiguredView(display, view),
  ): void {
    const resolvedLook = look?.trim();
    if (!resolvedLook) return;
    const configuredLooks = viewInfo?.looks?.trim() ?? '';
    if (configuredLooks === resolvedLook) return;

    throw new Error(
      `Project look "${resolvedLook}" does not match the OCIO looks configured for display "${display}" view "${view}".`,
    );
  }

  private isDataDisplayView(display: string, view: string): boolean {
    const viewInfo = this.getConfiguredView(display, view);
    if (!viewInfo) return false;

    const viewColorSpace = this.getConfiguredColorSpaceName(viewInfo.colorSpace);
    if (viewColorSpace) {
      return viewColorSpace === this.snapshot.dataColorSpace;
    }

    return this.getConfiguredColorSpaceName(viewInfo.name) === this.snapshot.dataColorSpace;
  }

  private disposeConfig(): void {
    this.clearCaches();
    this.config?.dispose();
    this.config = null;
  }

  private recordFailure(error: unknown): void {
    this.latestFailure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  }
}

export const colorManagementService = new OcioColorManagementService();
