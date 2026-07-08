import type { BuiltinColorConfigReference } from '@blackboard/types';
import { ColorManagementDefaults } from './constants';

export const BUILTIN_ACES_CG_CONFIG_ID = 'aces-cg-v4-aces-v2';

export interface ApplicationColorManagementDefaults {
  config: BuiltinColorConfigReference;
  display: string;
  view: string;
  localMonitorDisplayOverride: string | null;
  localMonitorViewOverride: string | null;
}

export const BUILTIN_ACES_CG_CONFIG_REFERENCE: BuiltinColorConfigReference = {
  kind: 'builtin',
  id: BUILTIN_ACES_CG_CONFIG_ID,
  uri: ColorManagementDefaults.CONFIG,
};

export const APPLICATION_COLOR_MANAGEMENT_DEFAULTS: ApplicationColorManagementDefaults = {
  config: BUILTIN_ACES_CG_CONFIG_REFERENCE,
  display: ColorManagementDefaults.DISPLAY,
  view: ColorManagementDefaults.VIEW,
  localMonitorDisplayOverride: null,
  localMonitorViewOverride: null,
};
