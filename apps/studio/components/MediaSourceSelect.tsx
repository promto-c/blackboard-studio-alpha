import { StyledDropdown } from '@blackboard/ui';
import * as Icons from '@blackboard/icons';
import { type MediaSourceOption } from '@/utils/mediaSourceSelection';

interface MediaSourceSelectProps {
  value: string;
  options: MediaSourceOption[];
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
}

export function MediaSourceSelect({
  value,
  options,
  onChange,
  label = 'Source',
  placeholder = 'Select Source...',
}: MediaSourceSelectProps) {
  const dropdownOptions = options.map((option) => {
    const isUpstream = option.kind === 'upstream';
    const Icon = isUpstream ? Icons.Branch : Icons.Photo;

    return {
      value: option.value,
      label: option.label,
      secondaryLabel: option.description,
      searchText: `${option.label} ${option.description}`,
      icon: (
        <span
          className={`grid h-6 w-6 place-items-center rounded ${
            isUpstream ? 'bg-primary-400/[0.13] text-primary-200' : 'bg-white/[0.055] text-gray-400'
          }`}
        >
          <Icon className="h-3 w-3" />
        </span>
      ),
    };
  });

  return (
    <div className="space-y-1">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="truncate text-[10px] font-medium text-gray-400">{label}</span>
      </div>
      <StyledDropdown
        value={value}
        options={dropdownOptions}
        onChange={(nextValue) => onChange(String(nextValue))}
        density="compact"
        placeholder={placeholder}
        widthClass="w-full"
        showSelectedBadges={false}
      />
    </div>
  );
}
