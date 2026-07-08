import { ColorManagementDefaults } from './constants';

export const normalizeBuiltinConfigName = (name: string | undefined | null): string => {
  const trimmed = name?.trim();
  if (!trimmed) return ColorManagementDefaults.CONFIG;
  return trimmed.startsWith('ocio://') ? trimmed : `ocio://${trimmed}`;
};

export const stripBuiltinConfigPrefix = (name: string): string =>
  name.startsWith('ocio://') ? name.slice('ocio://'.length) : name;
