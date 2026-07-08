import type { ProjectColorManagement, RequiredOcioRole } from '@blackboard/types';
import {
  normalizeBuiltinConfigName,
  resolveCanonicalColorSpaceName,
  type ColorManagementRuntimeSnapshot,
} from '@/color-management';
import { getDisplayViewSelectorModel } from './DisplayViewSelector';

const REQUIRED_ROLES: readonly RequiredOcioRole[] = [
  'scene_linear',
  'texture_paint',
  'color_picking',
  'data',
];

export interface ProjectRoleStatus {
  role: RequiredOcioRole;
  colorSpace: string | null;
  override: string | null;
  issue: string | null;
}

export interface ProjectColorManagementPanelModel {
  configIssue: string | null;
  roles: ProjectRoleStatus[];
  workingColorSpace: string;
  issues: string[];
}

export const getProjectColorManagementPanelModel = (
  project: ProjectColorManagement,
  runtime: Pick<
    ColorManagementRuntimeSnapshot,
    'configName' | 'colorSpaces' | 'roles' | 'displays' | 'viewsByDisplay' | 'error'
  >,
): ProjectColorManagementPanelModel => {
  const expectedConfig =
    project.config.kind === 'builtin'
      ? normalizeBuiltinConfigName(project.config.uri)
      : project.config.uri;
  const configIssue = runtime.error
    ? `Could not load project config "${project.config.uri}": ${runtime.error}`
    : expectedConfig === runtime.configName
      ? null
      : `Project config "${project.config.uri}" is not the active OCIO config "${runtime.configName}".`;
  const roles = REQUIRED_ROLES.map((role): ProjectRoleStatus => {
    const override =
      (role === 'scene_linear' ? project.workingSpace.override : undefined) ??
      project.roleOverrides?.[role] ??
      null;
    const configured =
      override ?? runtime.roles.find((candidate) => candidate.name === role)?.colorSpace ?? null;
    const colorSpace = configured
      ? resolveCanonicalColorSpaceName(runtime.colorSpaces, configured)
      : null;
    return {
      role,
      colorSpace,
      override,
      issue: colorSpace
        ? null
        : configured
          ? `Role "${role}" references unavailable color space "${configured}".`
          : `Required role "${role}" is unresolved.`,
    };
  });
  const displayIssue = getDisplayViewSelectorModel(
    runtime.displays,
    runtime.viewsByDisplay,
    project.viewer,
  ).issue;
  const contextIssues = Object.keys(project.context ?? {}).flatMap((key) =>
    key.trim() ? [] : ['Project OCIO context contains an empty variable name.'],
  );
  const issues = [
    configIssue,
    ...roles.map((role) => role.issue),
    displayIssue,
    ...contextIssues,
  ].filter((issue): issue is string => Boolean(issue));

  return {
    configIssue,
    roles,
    workingColorSpace:
      roles.find((role) => role.role === 'scene_linear')?.colorSpace ?? 'Unresolved',
    issues,
  };
};
