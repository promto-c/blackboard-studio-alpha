import React, { useEffect, useMemo, useRef, useState } from 'react';
import Popover from './Popover';
import ScrollArea from './ScrollArea';

const ChevronDown: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className="h-3 w-3 shrink-0 text-gray-400"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
  </svg>
);

interface DropdownOption {
  value: string | number;
  label: React.ReactNode;
  secondaryLabel?: React.ReactNode;
  badges?: Array<React.ReactNode>;
  searchText?: string;
}

interface StyledDropdownProps {
  value: string | number;
  options: DropdownOption[];
  onChange: (value: string | number) => void;
  widthClass?: string;
  popoverWidthClass?: string;
  searchable?: boolean;
  showSelectedBadges?: boolean;
}

const optionNodeToText = (node: React.ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(optionNodeToText).join(' ');
  }

  return '';
};

const getOptionSearchText = (option: DropdownOption): string =>
  [
    option.searchText,
    String(option.value),
    optionNodeToText(option.label),
    optionNodeToText(option.secondaryLabel),
    ...(option.badges ?? []).map(optionNodeToText),
  ]
    .join(' ')
    .toLowerCase();

const StyledDropdown: React.FC<StyledDropdownProps> = ({
  value,
  options,
  onChange,
  widthClass = 'w-full',
  popoverWidthClass,
  searchable,
  showSelectedBadges = true,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((option) => option.value === value);
  const shouldShowSearch = searchable ?? options.length > 8;
  const normalizedQuery = query.trim().toLowerCase();

  const visibleOptions = useMemo(
    () =>
      normalizedQuery
        ? options.filter((option) => getOptionSearchText(option).includes(normalizedQuery))
        : options,
    [normalizedQuery, options],
  );

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      return;
    }

    if (shouldShowSearch) {
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [isOpen, shouldShowSearch]);

  const triggerButtonClasses =
    'grid min-h-9 w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 overflow-hidden rounded bg-gray-700/50 px-2 py-2 text-left font-mono text-xs text-gray-200 border-0 focus:outline-none focus:ring-2 focus:ring-primary-700 focus:ring-offset-0 focus:ring-offset-gray-900';

  const renderOptionContent = (option: DropdownOption, compact = false, showBadges = true) => {
    const shouldShowDetails =
      option.secondaryLabel || (showBadges && option.badges && option.badges.length > 0);

    return (
      <div className="min-w-0 max-w-full overflow-hidden">
        <div className="block min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-left leading-4">
          {option.label}
        </div>

        {shouldShowDetails ? (
          <div
            className={`mt-1 flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden ${
              compact ? 'text-[10px]' : 'text-xs'
            } text-gray-400`}
          >
            {option.secondaryLabel ? (
              <span className="min-w-0 max-w-full shrink overflow-hidden text-ellipsis whitespace-nowrap leading-4">
                {option.secondaryLabel}
              </span>
            ) : null}

            {showBadges && option.badges && option.badges.length > 0 ? (
              <span className="flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden">
                {option.badges.map((badge, index) => (
                  <span
                    key={`${String(option.value)}-badge-${index}`}
                    className="inline-flex shrink-0 items-center rounded-full border border-primary-400/20 bg-primary-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-3 tracking-wide text-primary-100"
                  >
                    {badge}
                  </span>
                ))}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={`${widthClass} min-w-0 max-w-full overflow-hidden`}>
      <Popover
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        trigger={
          <button type="button" className={triggerButtonClasses}>
            {selectedOption ? (
              renderOptionContent(selectedOption, true, showSelectedBadges)
            ) : (
              <span className="min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
                Select...
              </span>
            )}

            <ChevronDown />
          </button>
        }
        widthClass={popoverWidthClass || widthClass}
      >
        {(close) => (
          <div className="min-w-0 max-w-full space-y-2 overflow-hidden">
            {shouldShowSearch ? (
              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && visibleOptions[0]) {
                    onChange(visibleOptions[0].value);
                    close();
                  }
                }}
                placeholder="Search..."
                className="w-full min-w-0 rounded-lg border border-white/10 bg-gray-950/70 px-2.5 py-2 text-xs text-gray-100 outline-none transition placeholder:text-gray-600 focus:border-primary-400/60 focus:ring-2 focus:ring-primary-400/20"
              />
            ) : null}

            <ScrollArea axis="y" viewportClassName="max-h-[min(22rem,calc(100vh-9rem))] pr-1">
              <div className="min-w-0 max-w-full space-y-1 overflow-hidden">
                {visibleOptions.length > 0 ? (
                  visibleOptions.map((option) => (
                    <button
                      key={String(option.value)}
                      type="button"
                      onClick={() => {
                        onChange(option.value);
                        close();
                      }}
                      title={getOptionSearchText(option)}
                      className={`w-full min-w-0 max-w-full overflow-hidden rounded-lg px-3 py-2 text-left text-sm transition-all duration-150 ${
                        value === option.value
                          ? 'bg-primary-500/30 text-white ring-1 ring-inset ring-primary-400/50'
                          : 'text-gray-300 hover:bg-white/10'
                      }`}
                    >
                      {renderOptionContent(option)}
                    </button>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-xs text-gray-500">
                    No matches
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        )}
      </Popover>
    </div>
  );
};

export default StyledDropdown;
