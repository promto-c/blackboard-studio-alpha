import {
  getRendererRuntimeDiagnostics,
  type RendererRuntimeDiagnostics,
} from '@blackboard/renderer';
import type { ProjectColorManagement } from '@blackboard/types';
import type { ViewerColorManagement } from './viewerIntent';
import { colorManagementService } from './service';
import type {
  ColorManagementRuntimeSnapshot,
  ColorManagementService,
  ColorManagementServiceDiagnostics,
  ResolvedProjectColorManagement,
} from './types';

export interface ColorManagementProjectDiagnostics {
  status: 'ready' | 'unavailable' | 'invalid';
  issue: string | null;
  display: string;
  view: string;
  look: string | null;
  context: Readonly<Record<string, string>>;
  overrides: readonly string[];
  roles: Readonly<Record<'scene_linear' | 'texture_paint' | 'color_picking' | 'data', string>>;
  localDisplayOverride: boolean;
}

export interface ColorManagementDiagnosticsSnapshot {
  service: ColorManagementServiceDiagnostics;
  renderer: RendererRuntimeDiagnostics;
  project: ColorManagementProjectDiagnostics;
  latestFailure: string | null;
}

export type ColorManagementDiagnosticRuntime = Pick<
  ColorManagementRuntimeSnapshot,
  'isInitialized' | 'isLoading' | 'error' | 'errorDetail' | 'version' | 'versionHex' | 'configName'
>;

const unavailableRoles = {
  scene_linear: 'Unavailable',
  texture_paint: 'Unavailable',
  color_picking: 'Unavailable',
  data: 'Unavailable',
} as const;

const getProjectOverrides = (project: ProjectColorManagement): string[] => {
  const overrides = Object.entries(project.roleOverrides ?? {}).map(
    ([role, colorSpace]) => `${role}=${colorSpace}`,
  );
  if (project.workingSpace.override) {
    overrides.push(`workingSpace=${project.workingSpace.override}`);
  }
  return overrides;
};

const toReadyProjectDiagnostics = (
  resolved: ResolvedProjectColorManagement,
  viewerColorManagement: ViewerColorManagement,
): ColorManagementProjectDiagnostics => ({
  status: 'ready',
  issue: null,
  display: viewerColorManagement.displayViewOverride?.display ?? resolved.display,
  view: viewerColorManagement.displayViewOverride?.view ?? resolved.view,
  look: viewerColorManagement.displayViewOverride?.look ?? resolved.look ?? null,
  context: resolved.context,
  overrides: getProjectOverrides(resolved.project),
  roles: {
    scene_linear: resolved.workingColorSpace,
    texture_paint: resolved.textureColorSpace,
    color_picking: resolved.colorPickingColorSpace,
    data: resolved.dataColorSpace,
  },
  localDisplayOverride: viewerColorManagement.displayViewOverride !== null,
});

export const collectColorManagementDiagnostics = (
  runtime: ColorManagementDiagnosticRuntime,
  project: ProjectColorManagement,
  viewerColorManagement: ViewerColorManagement,
  service: Pick<
    ColorManagementService,
    'getDiagnostics' | 'resolveProjectColorManagement'
  > = colorManagementService,
  renderer: RendererRuntimeDiagnostics = getRendererRuntimeDiagnostics(),
): ColorManagementDiagnosticsSnapshot => {
  const serviceDiagnostics = service.getDiagnostics();
  let projectDiagnostics: ColorManagementProjectDiagnostics;

  if (!runtime.isInitialized) {
    projectDiagnostics = {
      status: 'unavailable',
      issue: runtime.error ?? 'OpenColorIO is not initialized.',
      display: project.viewer.display,
      view: project.viewer.view,
      look: project.viewer.look ?? null,
      context: project.context ?? {},
      overrides: getProjectOverrides(project),
      roles: unavailableRoles,
      localDisplayOverride: viewerColorManagement.displayViewOverride !== null,
    };
  } else {
    try {
      projectDiagnostics = toReadyProjectDiagnostics(
        service.resolveProjectColorManagement(project),
        viewerColorManagement,
      );
    } catch (error) {
      projectDiagnostics = {
        status: 'invalid',
        issue: error instanceof Error ? error.message : String(error),
        display: project.viewer.display,
        view: project.viewer.view,
        look: project.viewer.look ?? null,
        context: project.context ?? {},
        overrides: getProjectOverrides(project),
        roles: unavailableRoles,
        localDisplayOverride: viewerColorManagement.displayViewOverride !== null,
      };
    }
  }

  return {
    service: serviceDiagnostics,
    renderer,
    project: projectDiagnostics,
    latestFailure:
      serviceDiagnostics.latestFailure ??
      renderer.latestFailure ??
      runtime.errorDetail ??
      runtime.error,
  };
};

const formatRecord = (value: Readonly<Record<string, string>>): string => {
  const entries = Object.entries(value);
  return entries.length > 0 ? entries.map(([key, entry]) => `${key}=${entry}`).join(', ') : 'None';
};

export const formatColorManagementDiagnostics = (
  runtime: ColorManagementDiagnosticRuntime,
  diagnostics: ColorManagementDiagnosticsSnapshot,
): string =>
  [
    `Runtime: ${runtime.isInitialized ? 'Ready' : runtime.error ? 'Failed' : 'Starting'}`,
    `OpenColorIO: ${runtime.version || 'Unavailable'} (${runtime.versionHex > 0 ? `0x${runtime.versionHex.toString(16).toUpperCase()}` : 'Unavailable'})`,
    `Config: ${runtime.configName}`,
    `Project: ${diagnostics.project.status}`,
    `Display/View/Look: ${diagnostics.project.display} / ${diagnostics.project.view} / ${diagnostics.project.look ?? 'None'}`,
    `Local display override: ${diagnostics.project.localDisplayOverride ? 'Yes' : 'No'}`,
    `Context: ${formatRecord(diagnostics.project.context)}`,
    `Overrides: ${diagnostics.project.overrides.join(', ') || 'None'}`,
    `Roles: ${formatRecord(diagnostics.project.roles)}`,
    `Caches: processors=${diagnostics.service.processorCacheEntries}, shaders=${diagnostics.service.shaderCacheEntries}, rgb=${diagnostics.service.rgbTransformCacheEntries}`,
    `Shader profile: ${diagnostics.service.shaderProfile}`,
    `Renderer: WebGL2=${diagnostics.renderer.webgl2}, float=${diagnostics.renderer.floatRenderTargets}, instances=${diagnostics.renderer.rendererCount}`,
    `Latest failure: ${diagnostics.latestFailure ?? diagnostics.project.issue ?? 'None'}`,
  ].join('\n');
