import { useEffect, useMemo, useRef, useState } from 'react';
import type { ColorConfigReference } from '@blackboard/types';
import { StyledDropdown } from '@blackboard/ui';
import * as Icons from '@blackboard/icons';
import { createBuiltinProjectColorConfigReference, type ColorConfigInfo } from '@/color-management';
import {
  ExternalConfigReferenceField,
  type ExternalConfigReferenceFieldHandle,
} from './ExternalConfigReferenceField';

export interface OcioConfigSelectorProps {
  value: ColorConfigReference;
  builtinConfigs: readonly ColorConfigInfo[];
  scope: 'application' | 'project';
  onChange: (value: ColorConfigReference) => void;
  error?: string | null;
}

const formatReferenceLabel = (reference: ColorConfigReference): string => {
  if (reference.kind === 'external') return reference.uri;
  return reference.id || reference.uri;
};

export function OcioConfigSelector({
  value,
  builtinConfigs,
  scope,
  onChange,
  error,
}: OcioConfigSelectorProps) {
  const externalFieldRef = useRef<ExternalConfigReferenceFieldHandle>(null);
  const [showExternalEditor, setShowExternalEditor] = useState(value.kind === 'external');

  useEffect(() => {
    if (value.kind === 'external') setShowExternalEditor(true);
  }, [value.kind]);

  const options = useMemo(() => {
    const builtinOptions = builtinConfigs.map((config) => ({
      value: `ocio://${config.name}`,
      label: config.name,
      secondaryLabel: config.uiName,
      badges: config.recommended ? ['Recommended'] : [],
      searchText: `${config.name} ${config.uiName}`,
    }));
    const hasCurrentValue = builtinOptions.some((option) => option.value === value.uri);
    const currentOption = hasCurrentValue
      ? []
      : [
          {
            value: value.uri,
            label: formatReferenceLabel(value),
            secondaryLabel: value.kind === 'external' ? 'External config' : 'Built-in config',
            badges: [],
            searchText: value.uri,
          },
        ];

    return [...currentOption, ...builtinOptions];
  }, [builtinConfigs, value]);

  const handleSelection = (nextValue: string | number) => {
    setShowExternalEditor(false);
    onChange(createBuiltinProjectColorConfigReference(String(nextValue)));
  };

  return (
    <div className="space-y-2">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <label className="text-xs font-medium text-gray-400">OCIO config</label>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setShowExternalEditor(true);
              window.requestAnimationFrame(() => externalFieldRef.current?.focusReference());
            }}
            title="Use external OCIO config reference"
            aria-label="Use external OCIO config reference"
            className="grid h-8 w-8 place-items-center rounded-md text-gray-400 transition hover:bg-white/[0.08] hover:text-white"
          >
            <Icons.Link className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setShowExternalEditor(true);
              window.requestAnimationFrame(() => externalFieldRef.current?.locateDirectory());
            }}
            title="Locate OCIO config directory"
            aria-label="Locate OCIO config directory"
            className="grid h-8 w-8 place-items-center rounded-md text-gray-400 transition hover:bg-white/[0.08] hover:text-white"
          >
            <Icons.FolderOpen className="h-4 w-4" />
          </button>
        </div>
      </div>

      <StyledDropdown
        value={value.uri}
        options={options}
        onChange={handleSelection}
        popoverWidthClass="w-[34rem]"
        searchable
        showSelectedBadges={false}
      />

      {showExternalEditor ? (
        <div className="rounded-lg border border-white/10 bg-black/20 p-2">
          <ExternalConfigReferenceField
            ref={externalFieldRef}
            value={value}
            scope={scope}
            showLocate={false}
            showReset={false}
            onChange={onChange}
          />
        </div>
      ) : null}

      {error ? <div className="text-xs text-red-200">{error}</div> : null}
    </div>
  );
}
