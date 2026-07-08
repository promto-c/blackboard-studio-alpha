import React from 'react';
import { StyledDropdown } from '@blackboard/ui';
import { useOcio } from '@/state/ocioContext';

interface OcioColorSpaceDropdownProps {
  value: string | undefined;
  onChange: (value: string) => void;
  includeData?: boolean;
  widthClass?: string;
  popoverWidthClass?: string;
}

const formatDescription = (value: string): string => value.replace(/\s+/g, ' ').trim();

export function OcioColorSpaceDropdown({
  value,
  onChange,
  includeData = true,
  widthClass = 'w-full',
  popoverWidthClass = 'w-80',
}: OcioColorSpaceDropdownProps) {
  const ocio = useOcio();
  const resolvedValue = value?.trim() ?? '';
  const canonicalValue = resolvedValue ? ocio.resolveColorSpaceName(resolvedValue) : '';

  const options = React.useMemo(
    () =>
      ocio.colorSpaces
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
    [includeData, ocio],
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
      />
    </div>
  );
}
