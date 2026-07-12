import { useMemo } from 'react';
import type {
  ColorConfigReference,
  ProjectColorManagement,
  RequiredOcioRole,
} from '@blackboard/types';
import { Badge, StyledDropdown, ToggleSwitch } from '@blackboard/ui';
import {
  getSceneLinearWorkingSpaceCandidates,
  type ColorConfigInfo,
  type ColorManagementRuntimeSnapshot,
} from '@/color-management';
import {
  ColorManagementControlRow,
  ColorManagementControlSection,
} from './ColorManagementControls';
import { DisplayViewSelector } from './DisplayViewSelector';
import { OcioConfigSelector } from './OcioConfigSelector';
import { OcioContextVariablesEditor } from './OcioContextVariablesEditor';
import { getProjectColorManagementPanelModel } from './ProjectColorManagementPanel';

const REQUIRED_ROLES: readonly RequiredOcioRole[] = [
  'scene_linear',
  'texture_paint',
  'color_picking',
  'data',
];

export interface ColorManagementSettingsEditorProps {
  scope: 'application' | 'project';
  value: ProjectColorManagement;
  runtime: ColorManagementRuntimeSnapshot | null;
  builtinConfigs: readonly ColorConfigInfo[];
  isLoading?: boolean;
  configError?: string | null;
  onChange: (value: ProjectColorManagement) => void;
  onConfigChange: (config: ColorConfigReference) => void;
  autoDetectViewportView?: boolean;
  onAutoDetectViewportViewChange?: (checked: boolean) => void;
}

const roleDisplayName = (role: RequiredOcioRole): string =>
  role
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const withRoleOverride = (
  value: ProjectColorManagement,
  role: RequiredOcioRole,
  colorSpace: string | null,
): ProjectColorManagement => {
  if (role === 'scene_linear') {
    return {
      ...value,
      workingSpace: {
        role: 'scene_linear',
        ...(colorSpace ? { override: colorSpace } : {}),
      },
    };
  }

  const roleOverrides = { ...(value.roleOverrides ?? {}) };
  if (colorSpace) roleOverrides[role] = colorSpace;
  else delete roleOverrides[role];
  const { roleOverrides: _previousOverrides, ...withoutRoleOverrides } = value;
  return Object.keys(roleOverrides).length
    ? { ...withoutRoleOverrides, roleOverrides }
    : withoutRoleOverrides;
};

export function ColorManagementSettingsEditor({
  scope,
  value,
  runtime,
  builtinConfigs,
  isLoading = false,
  configError,
  onChange,
  onConfigChange,
  autoDetectViewportView,
  onAutoDetectViewportViewChange,
}: ColorManagementSettingsEditorProps) {
  const model = useMemo(
    () => (runtime ? getProjectColorManagementPanelModel(value, runtime) : null),
    [runtime, value],
  );
  const colorSpaceOptions = useMemo(
    () =>
      (runtime?.colorSpaces ?? []).map((colorSpace) => {
        const label = colorSpace.canonicalName || colorSpace.name;
        return {
          value: label,
          label,
          secondaryLabel: colorSpace.family || colorSpace.encoding,
          searchText: `${colorSpace.name} ${colorSpace.canonicalName ?? ''} ${colorSpace.family} ${
            colorSpace.encoding
          }`,
        };
      }),
    [runtime],
  );
  const sceneLinearOptions = useMemo(
    () =>
      getSceneLinearWorkingSpaceCandidates(runtime?.colorSpaces ?? []).map((colorSpace) => {
        const label = colorSpace.canonicalName || colorSpace.name;
        return {
          value: label,
          label,
          secondaryLabel: colorSpace.family || colorSpace.encoding,
          badges: [colorSpace.encoding],
          searchText: `${colorSpace.name} ${colorSpace.canonicalName ?? ''} ${colorSpace.family} ${
            colorSpace.encoding
          }`,
        };
      }),
    [runtime],
  );

  const setRoleOverride = (role: RequiredOcioRole, colorSpace: string | null) =>
    onChange(withRoleOverride(value, role, colorSpace));

  return (
    <div className="min-w-0 space-y-3">
      <div className="min-w-0 space-y-3 rounded-lg border border-white/10 bg-black/20 p-3">
        <OcioConfigSelector
          value={value.config}
          builtinConfigs={builtinConfigs}
          scope={scope}
          onChange={onConfigChange}
          error={configError}
        />

        <div className="grid gap-2 border-t border-white/10 pt-3 sm:grid-cols-3">
          <div className="min-w-0 rounded-md bg-white/[0.03] px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Working space
            </div>
            <div className="mt-1 truncate font-mono text-xs text-gray-200">
              {model?.workingColorSpace ?? (isLoading ? 'Loading…' : 'Unavailable')}
            </div>
          </div>
          <div className="min-w-0 rounded-md bg-white/[0.03] px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              View
            </div>
            <div className="mt-1 truncate font-mono text-xs text-gray-200">
              {value.viewer.display} / {value.viewer.view}
            </div>
          </div>
          <div
            className="min-w-0 rounded-md bg-white/[0.03] px-3 py-2"
            title="OCIO file rules are read from the selected config."
          >
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              File rules
            </div>
            <div className="mt-1 truncate text-xs text-gray-200">From config</div>
          </div>
        </div>
      </div>

      <div className="grid min-w-0 items-start gap-3 lg:grid-cols-2">
        <ColorManagementControlSection
          title="Display view"
          onReset={() => {
            if (!runtime) return;
            onChange({
              ...value,
              viewer: {
                display: runtime.defaultDisplay,
                view: runtime.defaultView,
              },
            });
          }}
          resetDisabled={!runtime}
        >
          <DisplayViewSelector
            value={value.viewer}
            onChange={(viewer) => onChange({ ...value, viewer })}
            runtime={runtime}
            disabled={!runtime}
            popoverWidthClass="w-80"
            variant="control-rows"
          />
          {autoDetectViewportView !== undefined && onAutoDetectViewportViewChange ? (
            <div className="flex items-center justify-between gap-3 rounded-md bg-white/[0.03] px-3 py-2">
              <div className="text-xs text-gray-400">Initialize view from first input</div>
              <div className="flex items-center gap-3">
                <Badge variant={autoDetectViewportView ? 'accent' : 'neutral'}>
                  {autoDetectViewportView ? 'Auto' : 'Manual'}
                </Badge>
                <ToggleSwitch
                  checked={autoDetectViewportView}
                  ariaLabel="Toggle auto-initialize view from first input"
                  onCheckedChange={onAutoDetectViewportViewChange}
                />
              </div>
            </div>
          ) : null}
        </ColorManagementControlSection>

        <ColorManagementControlSection
          title="Roles"
          onReset={() =>
            onChange(
              REQUIRED_ROLES.reduce(
                (current, role) => withRoleOverride(current, role, null),
                value,
              ),
            )
          }
          resetDisabled={!runtime}
        >
          {REQUIRED_ROLES.map((role) => {
            const status = model?.roles.find((candidate) => candidate.role === role);
            if (!status) return null;
            const roleOptions =
              role === 'scene_linear' && sceneLinearOptions.length
                ? sceneLinearOptions
                : colorSpaceOptions;
            const selectedColorSpace = status.override ?? status.colorSpace ?? '';
            const options = roleOptions.length
              ? roleOptions
              : selectedColorSpace
                ? [{ value: selectedColorSpace, label: selectedColorSpace }]
                : [];

            return (
              <ColorManagementControlRow
                key={role}
                label={roleDisplayName(role)}
                onReset={() => setRoleOverride(role, null)}
                resetDisabled={!status.override}
                issue={status.issue}
              >
                <StyledDropdown
                  value={selectedColorSpace}
                  options={options}
                  onChange={(nextValue) => setRoleOverride(role, String(nextValue))}
                  searchable
                  popoverWidthClass="w-80"
                  showSelectedBadges={false}
                />
              </ColorManagementControlRow>
            );
          })}
        </ColorManagementControlSection>
      </div>

      {scope === 'project' ? (
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <OcioContextVariablesEditor
            value={value.context}
            onChange={(context) => {
              const { context: _previousContext, ...withoutContext } = value;
              onChange(context ? { ...withoutContext, context } : withoutContext);
            }}
            emptyLabel="No project context variables."
          />
        </div>
      ) : null}
    </div>
  );
}
