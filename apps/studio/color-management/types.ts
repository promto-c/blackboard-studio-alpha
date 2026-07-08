import type { RendererColorManagement } from '@blackboard/renderer';
import type { ColorConfigReference, ProjectColorManagement } from '@blackboard/types';

export interface ColorConfigInfo {
  name: string;
  uiName?: string;
  recommended?: boolean;
}

export interface ColorConfigVersion {
  major: number;
  minor: number;
}

export interface ColorSpaceInfo {
  name: string;
  canonicalName?: string;
  aliases: string[];
  categories: string[];
  family: string;
  encoding: string;
  description: string;
  isData: boolean;
}

export interface ColorRoleInfo {
  name: string;
  colorSpace: string;
}

export interface OptionalColorRoleIssue {
  name: string;
  colorSpace: string | null;
  message: string;
}

export interface DisplayViewInfo {
  name: string;
  colorSpace: string;
  transform: string;
  looks: string;
}

export interface ColorManagementRuntimeSnapshot {
  isInitialized: boolean;
  isLoading: boolean;
  version: string;
  versionHex: number;
  configName: string;
  configVersion: ColorConfigVersion | null;
  error: string | null;
  errorDetail: string | null;
  builtinConfigs: ColorConfigInfo[];
  colorSpaces: ColorSpaceInfo[];
  roles: ColorRoleInfo[];
  optionalRoleIssues: OptionalColorRoleIssue[];
  displays: string[];
  viewsByDisplay: Record<string, DisplayViewInfo[]>;
  defaultViewsByDisplay: Record<string, string>;
  defaultDisplay: string;
  defaultView: string;
  workingColorSpace: string;
  textureColorSpace: string;
  colorPickingColorSpace: string;
  dataColorSpace: string;
  logColorSpace?: string;
}

export interface ResolvedProjectColorManagement {
  project: ProjectColorManagement;
  config: ColorConfigReference;
  workingColorSpace: string;
  textureColorSpace: string;
  colorPickingColorSpace: string;
  dataColorSpace: string;
  logColorSpace?: string;
  display: string;
  view: string;
  look?: string;
  context: Record<string, string>;
}

export interface ResolvedOcioFileRule {
  sourceColorSpace: string;
  ruleName: string;
  isDefaultRule: boolean;
  isData: boolean;
  detail: string;
}

export interface ColorManagementServiceDiagnostics {
  processorCacheEntries: number;
  shaderCacheEntries: number;
  rgbTransformCacheEntries: number;
  shaderProfile: 'GLSL ES 3.0';
  latestFailure: string | null;
}

export interface ColorManagementService {
  initialize(configName?: string): Promise<ColorManagementRuntimeSnapshot>;
  initializeConfig(reference: ColorConfigReference): Promise<ColorManagementRuntimeSnapshot>;
  inspectConfig(reference: ColorConfigReference): Promise<ColorManagementRuntimeSnapshot>;
  getSnapshot(): ColorManagementRuntimeSnapshot;
  getRendererColorManagement(context?: Readonly<Record<string, string>>): RendererColorManagement;
  getProjectRendererColorManagement(project: ProjectColorManagement): RendererColorManagement;
  resolveProjectColorManagement(project: ProjectColorManagement): ResolvedProjectColorManagement;
  transformRgb(
    source: string,
    destination: string,
    color: readonly [number, number, number],
    context?: Readonly<Record<string, string>>,
  ): [number, number, number];
  invalidateContext(context: Readonly<Record<string, string>>): void;
  resolveColorSpaceName(value: string | undefined | null): string;
  resolveConfiguredColorSpaceName(value: string): string;
  resolveFileRule(filePath: string): ResolvedOcioFileRule;
  getDefaultView(display: string | undefined | null, colorSpace?: string): string;
  getViews(display: string | undefined | null): DisplayViewInfo[];
  getDiagnostics(): ColorManagementServiceDiagnostics;
  clearCaches(): void;
}
