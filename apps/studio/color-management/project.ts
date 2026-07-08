import {
  PROJECT_COLOR_MANAGEMENT_SCHEMA_VERSION,
  type ColorConfigReference,
  type PersistedProjectState,
  type ProjectColorManagement,
  type RequiredOcioRole,
} from '@blackboard/types';
import {
  APPLICATION_COLOR_MANAGEMENT_DEFAULTS,
  BUILTIN_ACES_CG_CONFIG_REFERENCE,
} from './defaults';
import { normalizeBuiltinConfigName, stripBuiltinConfigPrefix } from './config';
import type { ColorManagementRuntimeSnapshot } from './types';

const REQUIRED_OCIO_ROLES: readonly RequiredOcioRole[] = [
  'scene_linear',
  'texture_paint',
  'color_picking',
  'data',
];

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const readNonEmptyString = (value: UnknownRecord, key: string, path: string): string => {
  const candidate = value[key];
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    throw new Error(`${path}.${key} must be a non-empty string.`);
  }
  return candidate;
};

const assertOptionalNonEmptyString = (value: UnknownRecord, key: string, path: string) => {
  const candidate = value[key];
  if (candidate === undefined) return;
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    throw new Error(`${path}.${key} must be a non-empty string when provided.`);
  }
};

const assertStringMap = (value: unknown, path: string, options?: { requireEntries?: boolean }) => {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object with string values.`);
  }

  const entries = Object.entries(value);
  if (options?.requireEntries && entries.length === 0) {
    throw new Error(`${path} must be omitted when it has no values.`);
  }

  entries.forEach(([key, entryValue]) => {
    if (key.trim().length === 0) {
      throw new Error(`${path} contains an empty key.`);
    }
    if (typeof entryValue !== 'string') {
      throw new Error(`${path}.${key} must be a string.`);
    }
  });
};

export const createBuiltinProjectColorConfigReference = (
  configName: string | undefined | null,
): ColorConfigReference => {
  const uri = normalizeBuiltinConfigName(configName);
  if (uri === BUILTIN_ACES_CG_CONFIG_REFERENCE.uri) {
    return { ...BUILTIN_ACES_CG_CONFIG_REFERENCE };
  }

  return {
    kind: 'builtin',
    id: stripBuiltinConfigPrefix(uri),
    uri,
  };
};

export const cloneProjectColorManagement = (
  colorManagement: ProjectColorManagement,
): ProjectColorManagement => ({
  schemaVersion: colorManagement.schemaVersion,
  config: { ...colorManagement.config },
  workingSpace: { ...colorManagement.workingSpace },
  viewer: { ...colorManagement.viewer },
  ...(colorManagement.roleOverrides ? { roleOverrides: { ...colorManagement.roleOverrides } } : {}),
  ...(colorManagement.context ? { context: { ...colorManagement.context } } : {}),
});

export const createDefaultProjectColorManagement = (options?: {
  config?: ColorConfigReference;
}): ProjectColorManagement => ({
  schemaVersion: PROJECT_COLOR_MANAGEMENT_SCHEMA_VERSION,
  config: { ...(options?.config ?? APPLICATION_COLOR_MANAGEMENT_DEFAULTS.config) },
  workingSpace: {
    role: 'scene_linear',
  },
  viewer: {
    display: APPLICATION_COLOR_MANAGEMENT_DEFAULTS.display,
    view: APPLICATION_COLOR_MANAGEMENT_DEFAULTS.view,
  },
});

export const createProjectColorManagementFromOcioDefaults = (
  config: ColorConfigReference,
  runtime: Pick<ColorManagementRuntimeSnapshot, 'defaultDisplay' | 'defaultView'>,
): ProjectColorManagement => ({
  schemaVersion: PROJECT_COLOR_MANAGEMENT_SCHEMA_VERSION,
  config: { ...config },
  workingSpace: {
    role: 'scene_linear',
  },
  viewer: {
    display: runtime.defaultDisplay,
    view: runtime.defaultView,
  },
});

export const assertProjectColorManagement = (
  value: unknown,
  path = 'project.colorManagement',
): ProjectColorManagement => {
  if (!isRecord(value)) {
    throw new Error(
      'Project color management is missing; old color-management project schemas are not supported.',
    );
  }

  if (value.schemaVersion !== PROJECT_COLOR_MANAGEMENT_SCHEMA_VERSION) {
    throw new Error(
      `${path}.schemaVersion ${String(value.schemaVersion)} is not supported. Expected ${PROJECT_COLOR_MANAGEMENT_SCHEMA_VERSION}.`,
    );
  }

  if (!isRecord(value.config)) {
    throw new Error(`${path}.config must be a built-in or external config reference.`);
  }

  if (value.config.kind === 'builtin') {
    readNonEmptyString(value.config, 'id', `${path}.config`);
    readNonEmptyString(value.config, 'uri', `${path}.config`);
  } else if (value.config.kind === 'external') {
    readNonEmptyString(value.config, 'uri', `${path}.config`);
  } else {
    throw new Error(`${path}.config.kind must be "builtin" or "external".`);
  }

  if (!isRecord(value.workingSpace)) {
    throw new Error(`${path}.workingSpace must be an object.`);
  }
  if (value.workingSpace.role !== 'scene_linear') {
    throw new Error(`${path}.workingSpace.role must be "scene_linear".`);
  }
  assertOptionalNonEmptyString(value.workingSpace, 'override', `${path}.workingSpace`);

  if (!isRecord(value.viewer)) {
    throw new Error(`${path}.viewer must be an object.`);
  }
  readNonEmptyString(value.viewer, 'display', `${path}.viewer`);
  readNonEmptyString(value.viewer, 'view', `${path}.viewer`);
  assertOptionalNonEmptyString(value.viewer, 'look', `${path}.viewer`);

  if (value.roleOverrides !== undefined) {
    assertStringMap(value.roleOverrides, `${path}.roleOverrides`, { requireEntries: true });
    Object.keys(value.roleOverrides).forEach((key) => {
      if (!REQUIRED_OCIO_ROLES.includes(key as RequiredOcioRole)) {
        throw new Error(`${path}.roleOverrides.${key} is not a supported OCIO role override.`);
      }
    });
  }

  if (value.context !== undefined) {
    assertStringMap(value.context, `${path}.context`, { requireEntries: true });
  }

  return value as unknown as ProjectColorManagement;
};

export const assertPersistedProjectColorManagementState = (
  value: unknown,
): PersistedProjectState => {
  if (!isRecord(value)) {
    throw new Error('Project state is missing.');
  }

  assertProjectColorManagement(value.colorManagement);

  const history = value.history;
  if (Array.isArray(history)) {
    history.forEach((entry, index) => {
      if (!isRecord(entry) || !isRecord(entry.state)) return;
      if (entry.state.colorManagement !== undefined) {
        assertProjectColorManagement(
          entry.state.colorManagement,
          `project.history[${index}].state.colorManagement`,
        );
      }
    });
  }

  return value as PersistedProjectState;
};
