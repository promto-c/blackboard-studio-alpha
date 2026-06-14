import type { RendererColorManagement, RendererOcioShaderInfo } from '@blackboard/renderer';
import type {
  BuiltinConfigInfo,
  ColorSpaceInfo,
  Config,
  DisplayViewProcessorOptions,
  GpuShaderInfo,
  OCIO,
  Processor,
  RoleInfo,
  ViewInfo,
} from '@bb-studio/ocio';
import { ACES_CG_V4_CONFIG, createOCIO } from '@bb-studio/ocio';

export const OcioDefaults = {
  CONFIG: ACES_CG_V4_CONFIG,
  DISPLAY: 'sRGB - Display',
  VIEW: 'ACES 2.0 - SDR 100 nits (Rec.709)',
  WORKING_SPACE: 'ACEScg',
  TEXTURE_SPACE: 'sRGB Encoded Rec.709 (sRGB)',
  DATA_SPACE: 'Raw',
} as const;

export interface OcioRuntimeSnapshot {
  isInitialized: boolean;
  isLoading: boolean;
  version: string;
  versionHex: number;
  configName: string;
  configVersion: { major: number; minor: number } | null;
  error: string | null;
  builtinConfigs: BuiltinConfigInfo[];
  colorSpaces: ColorSpaceInfo[];
  roles: RoleInfo[];
  displays: string[];
  viewsByDisplay: Record<string, ViewInfo[]>;
  defaultDisplay: string;
  defaultView: string;
  workingColorSpace: string;
  textureColorSpace: string;
  dataColorSpace: string;
}

type ShaderKind = 'display' | 'colorspace';

const emptySnapshot = (): OcioRuntimeSnapshot => ({
  isInitialized: false,
  isLoading: false,
  version: '',
  versionHex: 0,
  configName: OcioDefaults.CONFIG,
  configVersion: null,
  error: null,
  builtinConfigs: [],
  colorSpaces: [],
  roles: [],
  displays: [],
  viewsByDisplay: {},
  defaultDisplay: OcioDefaults.DISPLAY,
  defaultView: OcioDefaults.VIEW,
  workingColorSpace: OcioDefaults.WORKING_SPACE,
  textureColorSpace: OcioDefaults.TEXTURE_SPACE,
  dataColorSpace: OcioDefaults.DATA_SPACE,
});

const normalizeBuiltinConfigName = (name: string | undefined | null): string => {
  const trimmed = name?.trim();
  if (!trimmed) return OcioDefaults.CONFIG;
  return trimmed.startsWith('ocio://') ? trimmed : `ocio://${trimmed}`;
};

const stripBuiltinConfigPrefix = (name: string): string =>
  name.startsWith('ocio://') ? name.slice('ocio://'.length) : name;

const hashKey = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
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

const getRoleColorSpace = (roles: RoleInfo[], roleName: string, fallback: string): string =>
  roles.find((role) => role.name === roleName)?.colorSpace || fallback;

class OcioManager {
  private ocio: OCIO | null = null;
  private config: Config | null = null;
  private snapshot = emptySnapshot();
  private initPromise: Promise<OcioRuntimeSnapshot> | null = null;
  private colorSpaceLookup = new Map<string, string>();
  private processorCache = new Map<string, Processor>();
  private shaderCache = new Map<string, RendererOcioShaderInfo | null>();

  public async initialize(configName: string = OcioDefaults.CONFIG): Promise<OcioRuntimeSnapshot> {
    const normalizedConfigName = normalizeBuiltinConfigName(configName);
    if (
      this.snapshot.isInitialized &&
      this.snapshot.configName === normalizedConfigName &&
      !this.snapshot.error
    ) {
      return this.snapshot;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.snapshot = {
      ...this.snapshot,
      isLoading: true,
      configName: normalizedConfigName,
      error: null,
    };

    this.initPromise = this.load(normalizedConfigName).finally(() => {
      this.initPromise = null;
    });

    return this.initPromise;
  }

  public getSnapshot(): OcioRuntimeSnapshot {
    return this.snapshot;
  }

  public getRendererColorManagement(): RendererColorManagement | undefined {
    if (!this.snapshot.isInitialized || !this.config) return undefined;

    return {
      getColorSpaceTransform: (source, destination) =>
        this.getColorSpaceShader(source, destination),
      getDisplayViewTransform: (source, display, view) =>
        this.getDisplayViewShader(source, display, view),
      resolveColorSpaceName: (value) => this.resolveColorSpaceName(value),
      defaultDisplay: this.snapshot.defaultDisplay,
      defaultView: this.snapshot.defaultView,
      workingColorSpace: this.snapshot.workingColorSpace,
      textureColorSpace: this.snapshot.textureColorSpace,
      dataColorSpace: this.snapshot.dataColorSpace,
    };
  }

  public resolveColorSpaceName(value: string | undefined | null): string {
    const trimmed = value?.trim();
    if (!trimmed) return this.snapshot.textureColorSpace;

    if (trimmed === 'Linear') return this.snapshot.workingColorSpace;
    if (trimmed === 'sRGB') return this.snapshot.textureColorSpace;
    if (trimmed === 'Raw') return this.snapshot.dataColorSpace;

    return this.colorSpaceLookup.get(trimmed.toLowerCase()) ?? trimmed;
  }

  public getDefaultView(display: string | undefined | null, colorSpace?: string): string {
    if (!this.config) return this.snapshot.defaultView;
    const resolvedDisplay = display || this.snapshot.defaultDisplay;
    try {
      return (
        this.config.getDefaultView(resolvedDisplay, this.resolveColorSpaceName(colorSpace)) ||
        this.config.getDefaultView(resolvedDisplay) ||
        this.snapshot.viewsByDisplay[resolvedDisplay]?.[0]?.name ||
        this.snapshot.defaultView
      );
    } catch {
      return this.snapshot.viewsByDisplay[resolvedDisplay]?.[0]?.name || this.snapshot.defaultView;
    }
  }

  public getViews(display: string | undefined | null): ViewInfo[] {
    const resolvedDisplay = display || this.snapshot.defaultDisplay;
    return this.snapshot.viewsByDisplay[resolvedDisplay] ?? [];
  }

  public getColorSpaceShader(
    source: string | undefined | null,
    destination: string | undefined | null,
  ): RendererOcioShaderInfo | null {
    if (!this.config || !this.snapshot.isInitialized) return null;
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

    const key = `cs:${src}->${dst}`;
    if (this.shaderCache.has(key)) {
      return this.shaderCache.get(key) ?? null;
    }

    try {
      const processor = this.getProcessor(key, () =>
        this.config!.createColorSpaceProcessor(src, dst, { optimization: 'lossless' }),
      );
      if (processor.isNoOp || processor.isIdentity) {
        this.shaderCache.set(key, null);
        return null;
      }
      const shaderKey = hashKey(key);
      const shaderInfo = processor.getGpuShaderInfo({
        language: 'glsl_es_3.0',
        functionName: `OCIOColorTransform_${shaderKey}`,
        resourcePrefix: `ocio_cs_${shaderKey}`,
        allowTexture1D: false,
      });
      const rendererInfo = toRendererShaderInfo(shaderInfo, 'colorspace', key);
      this.shaderCache.set(key, rendererInfo);
      return rendererInfo;
    } catch (error) {
      console.warn(`Failed to create OCIO color-space transform ${src} -> ${dst}:`, error);
      this.shaderCache.set(key, null);
      return null;
    }
  }

  public getDisplayViewShader(
    source: string | undefined | null,
    display: string | undefined | null,
    view: string | undefined | null,
  ): RendererOcioShaderInfo | null {
    if (!this.config || !this.snapshot.isInitialized) return null;
    const src = this.resolveColorSpaceName(source || this.snapshot.workingColorSpace);
    const resolvedDisplay = display || this.snapshot.defaultDisplay;
    const resolvedView = view || this.getDefaultView(resolvedDisplay, src);
    if (!src || !resolvedDisplay || !resolvedView || resolvedView === 'Raw') return null;

    const key = `display:${src}->${resolvedDisplay}/${resolvedView}`;
    if (this.shaderCache.has(key)) {
      return this.shaderCache.get(key) ?? null;
    }

    try {
      const processor = this.getProcessor(key, () =>
        this.config!.createDisplayViewProcessor({
          source: src,
          display: resolvedDisplay,
          view: resolvedView,
          optimization: 'lossless',
        } satisfies DisplayViewProcessorOptions),
      );
      if (processor.isNoOp || processor.isIdentity) {
        this.shaderCache.set(key, null);
        return null;
      }
      const shaderKey = hashKey(key);
      const shaderInfo = processor.getGpuShaderInfo({
        language: 'glsl_es_3.0',
        functionName: `OCIODisplay_${shaderKey}`,
        resourcePrefix: `ocio_view_${shaderKey}`,
        allowTexture1D: false,
      });
      const rendererInfo = toRendererShaderInfo(shaderInfo, 'display', key);
      this.shaderCache.set(key, rendererInfo);
      return rendererInfo;
    } catch (error) {
      console.warn(
        `Failed to create OCIO display/view transform ${src} -> ${resolvedDisplay}/${resolvedView}:`,
        error,
      );
      this.shaderCache.set(key, null);
      return null;
    }
  }

  private async load(configName: string): Promise<OcioRuntimeSnapshot> {
    try {
      this.disposeConfig();

      if (!this.ocio) {
        this.ocio = await createOCIO();
      }

      const builtinConfigs = this.ocio.listBuiltinConfigs();
      const config = this.ocio.createBuiltinConfig(configName);
      config.validate();

      const colorSpaces = config.listColorSpaces();
      const roles = config.listRoles();
      const displays = config.listDisplays();
      const defaultDisplay = config.getDefaultDisplay() || displays[0] || OcioDefaults.DISPLAY;
      const workingColorSpace = getRoleColorSpace(
        roles,
        'scene_linear',
        OcioDefaults.WORKING_SPACE,
      );
      const textureColorSpace = getRoleColorSpace(
        roles,
        'texture_paint',
        OcioDefaults.TEXTURE_SPACE,
      );
      const dataColorSpace = getRoleColorSpace(roles, 'data', OcioDefaults.DATA_SPACE);
      const defaultView =
        config.getDefaultView(defaultDisplay, workingColorSpace) ||
        config.getDefaultView(defaultDisplay) ||
        OcioDefaults.VIEW;
      const viewsByDisplay = Object.fromEntries(
        displays.map((display) => [display, config.listViews(display)]),
      );

      this.config = config;
      this.colorSpaceLookup = this.buildColorSpaceLookup(colorSpaces);
      this.snapshot = {
        isInitialized: true,
        isLoading: false,
        version: this.ocio.version,
        versionHex: this.ocio.versionHex,
        configName,
        configVersion: config.version,
        error: null,
        builtinConfigs,
        colorSpaces,
        roles,
        displays,
        viewsByDisplay,
        defaultDisplay,
        defaultView,
        workingColorSpace,
        textureColorSpace,
        dataColorSpace,
      };
      return this.snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Failed to initialize OpenColorIO:', error);
      this.disposeConfig();
      this.snapshot = {
        ...emptySnapshot(),
        isLoading: false,
        configName,
        error: message,
      };
      return this.snapshot;
    }
  }

  private buildColorSpaceLookup(colorSpaces: ColorSpaceInfo[]): Map<string, string> {
    const lookup = new Map<string, string>();
    for (const colorSpace of colorSpaces) {
      const names = [colorSpace.name, colorSpace.canonicalName, ...colorSpace.aliases].filter(
        Boolean,
      );
      names.forEach((name) => lookup.set(name.toLowerCase(), colorSpace.name));
    }
    return lookup;
  }

  private getProcessor(key: string, factory: () => Processor): Processor {
    const existing = this.processorCache.get(key);
    if (existing) return existing;
    const processor = factory();
    this.processorCache.set(key, processor);
    return processor;
  }

  private disposeConfig(): void {
    this.processorCache.forEach((processor) => processor.dispose());
    this.processorCache.clear();
    this.shaderCache.clear();
    this.config?.dispose();
    this.config = null;
    this.colorSpaceLookup.clear();
  }
}

export const ocioManager = new OcioManager();
export { normalizeBuiltinConfigName, stripBuiltinConfigPrefix };
