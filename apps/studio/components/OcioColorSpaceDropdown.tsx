import React from 'react';
import { StyledDropdown } from '@blackboard/ui';
import {
  OCIO_COMPOSITING_LOG_SPACE,
  OCIO_PROJECT_WORKING_SPACE,
  OCIO_TEXTURE_COLOR_SPACE,
} from '@blackboard/types';
import { useOcio } from '@/state/ocioContext';

interface OcioColorSpaceDropdownProps {
  value: string | undefined;
  onChange: (value: string) => void;
  includeData?: boolean;
  widthClass?: string;
  popoverWidthClass?: string;
  includeRoles?: boolean;
  disabled?: boolean;
}

const formatDescription = (value: string): string => value.replace(/\s+/g, ' ').trim();

export function OcioColorSpaceDropdown({
  value,
  onChange,
  includeData = true,
  widthClass = 'w-full',
  popoverWidthClass = 'w-80',
  includeRoles = false,
  disabled = false,
}: OcioColorSpaceDropdownProps) {
  const ocio = useOcio();
  const resolvedValue = value?.trim() ?? '';
  const isRoleValue =
    resolvedValue === OCIO_PROJECT_WORKING_SPACE ||
    resolvedValue === OCIO_TEXTURE_COLOR_SPACE ||
    resolvedValue === OCIO_COMPOSITING_LOG_SPACE;
  const canonicalValue = resolvedValue
    ? isRoleValue
      ? resolvedValue
      : ocio.resolveColorSpaceName(resolvedValue)
    : '';

  const options = React.useMemo(
    () => [
      ...(includeRoles
        ? [
            {
              value: OCIO_PROJECT_WORKING_SPACE,
              label: 'Project Working · ' + ocio.workingColorSpace,
              secondaryLabel: 'Resolved from the project scene_linear role.',
              badges: ['Role'],
              searchText: 'project working scene linear ' + ocio.workingColorSpace,
            },
            {
              value: OCIO_TEXTURE_COLOR_SPACE,
              label: 'Texture / Paint · ' + ocio.textureColorSpace,
              secondaryLabel: 'Resolved from the texture_paint role.',
              badges: ['Role'],
              searchText: 'texture paint ' + ocio.textureColorSpace,
            },
            ...(ocio.logColorSpace
              ? [
                  {
                    value: OCIO_COMPOSITING_LOG_SPACE,
                    label: 'Compositing Log · ' + ocio.logColorSpace,
                    secondaryLabel: 'Resolved from the compositing_log role.',
                    badges: ['Role'],
                    searchText: 'compositing log ' + ocio.logColorSpace,
                  },
                ]
              : []),
          ]
        : []),
      ...ocio.colorSpaces
        .filter((colorSpace) => includeData || !colorSpace.isData)
        .map((colorSpace) => ({
          value: colorSpace.name,
          label: colorSpace.name,
          secondaryLabel: colorSpace.description
            ? formatDescription(colorSpace.description)
            : colorSpace.family || colorSpace.encoding,
          badges: [
            colorSpace.family || undefined,
            colorSpace.encoding || undefined,
            colorSpace.isData ? 'Data' : undefined,
          ].filter(Boolean) as string[],
          searchText: [
            colorSpace.name,
            colorSpace.canonicalName,
            colorSpace.family,
            colorSpace.encoding,
            colorSpace.description,
            ...colorSpace.aliases,
            ...colorSpace.categories,
          ].join(' '),
        })),
    ],
    [includeData, includeRoles, ocio],
  );

  const selectedValue = options.some((option) => option.value === canonicalValue)
    ? canonicalValue
    : resolvedValue;
  const hasUnresolvedValue =
    Boolean(resolvedValue) && !options.some((option) => option.value === selectedValue);

  return (
    <div className="space-y-1.5">
      {hasUnresolvedValue ? (
        <div className="rounded-lg border border-red-400/20 bg-red-500/10 px-2.5 py-2 text-xs leading-5 text-red-100">
          Missing color space: <span className="font-mono">{resolvedValue}</span>
        </div>
      ) : null}
      <StyledDropdown
        value={selectedValue}
        options={options}
        onChange={(nextValue) => onChange(String(nextValue))}
        widthClass={widthClass}
        popoverWidthClass={popoverWidthClass}
        searchable
        disabled={disabled}
      />
    </div>
  );
}
