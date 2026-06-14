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

const legacyOptions = [
  { value: 'sRGB', label: 'sRGB', secondaryLabel: 'Legacy Rec.709 texture' },
  { value: 'Linear', label: 'Linear', secondaryLabel: 'Legacy scene-linear alias' },
  { value: 'Raw', label: 'Raw', secondaryLabel: 'Data, no color transform' },
];

const formatDescription = (value: string): string => value.replace(/\s+/g, ' ').trim();

export function OcioColorSpaceDropdown({
  value,
  onChange,
  includeData = true,
  widthClass = 'w-full',
  popoverWidthClass = 'w-80',
}: OcioColorSpaceDropdownProps) {
  const ocio = useOcio();
  const resolvedValue = value || ocio.textureColorSpace || 'sRGB';
  const canonicalValue = ocio.resolveColorSpaceName(resolvedValue);

  const options = React.useMemo(() => {
    if (!ocio.isInitialized) {
      return includeData ? legacyOptions : legacyOptions.filter((option) => option.value !== 'Raw');
    }

    const mapped = ocio.colorSpaces
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
      }));

    if (
      resolvedValue &&
      !mapped.some((option) => option.value === resolvedValue) &&
      !mapped.some((option) => option.value === canonicalValue)
    ) {
      mapped.unshift({
        value: resolvedValue,
        label: resolvedValue,
        secondaryLabel: 'Stored project value',
        badges: ['Current'],
        searchText: resolvedValue,
      });
    }

    return mapped;
  }, [canonicalValue, includeData, ocio, resolvedValue]);

  return (
    <StyledDropdown
      value={
        options.some((option) => option.value === canonicalValue) ? canonicalValue : resolvedValue
      }
      options={options}
      onChange={(nextValue) => onChange(String(nextValue))}
      widthClass={widthClass}
      popoverWidthClass={popoverWidthClass}
      searchable
    />
  );
}
