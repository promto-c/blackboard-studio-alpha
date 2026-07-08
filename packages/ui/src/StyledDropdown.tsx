import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from '@blackboard/icons';
import { Badge } from './Badge';
import Popover from './Popover';
import ScrollArea from './ScrollArea';

function ChevronDown({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={`h-3.5 w-3.5 shrink-0 transition duration-150 ${
        isOpen ? 'rotate-180 text-primary-300' : 'text-gray-400'
      }`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

interface DropdownOption {
  value: string | number;
  label: React.ReactNode;
  icon?: React.ReactNode;
  secondaryLabel?: React.ReactNode;
  badges?: Array<React.ReactNode>;
  searchText?: string;
}

interface StyledDropdownProps {
  value: string | number;
  options: DropdownOption[];
  onChange: (value: string | number) => void;
  density?: 'default' | 'compact';
  placeholder?: React.ReactNode;
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

function StyledDropdown({
  value,
  options,
  onChange,
  density = 'default',
  placeholder = 'Select...',
  widthClass = 'w-full',
  popoverWidthClass,
  searchable,
  showSelectedBadges = true,
}: StyledDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionsContainerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((option) => option.value === value);
  const isCompactDensity = density === 'compact';
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

  useEffect(() => {
    setActiveIndex(0);
  }, [normalizedQuery, isOpen]);

  useEffect(() => {
    if (!isOpen || visibleOptions.length === 0) return;
    const container = optionsContainerRef.current;
    if (!container) return;
    const activeButton = container.children[activeIndex] as HTMLElement | undefined;
    activeButton?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isOpen, visibleOptions.length]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (visibleOptions.length === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((prev) => (prev < visibleOptions.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : visibleOptions.length - 1));
        break;
      case 'Enter':
      case 'Tab':
        event.preventDefault();
        if (visibleOptions[activeIndex]) {
          onChange(visibleOptions[activeIndex].value);
          setIsOpen(false);
        }
        break;
    }
  };

  const triggerButtonClasses = `bb-dropdown-trigger bb-dropdown-surface grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)_auto] items-center overflow-hidden rounded-lg border-0 text-left transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/30 ${
    isCompactDensity
      ? 'min-h-9 gap-2 px-2 py-1.5 font-sans text-[11px]'
      : 'min-h-9 gap-3 px-2.5 py-2 font-mono text-xs'
  } ${
    isOpen
      ? 'bg-white/[0.1] text-primary-50 shadow-[inset_0_0_0_1px_rgb(var(--color-primary-400)/0.6),0_0_0_3px_rgb(var(--color-primary-500)/0.1),0_0_14px_rgb(var(--color-primary-500)/0.16)]'
      : 'bg-white/[0.08] text-gray-200 hover:bg-white/[0.11]'
  }`;

  const renderOptionContent = (option: DropdownOption, compact = false, showBadges = true) => {
    const hasBadges = showBadges && Boolean(option.badges && option.badges.length > 0);
    const shouldShowDetails = option.secondaryLabel || hasBadges;

    return (
      <div
        className={`min-w-0 max-w-full overflow-hidden ${
          option.icon ? 'flex items-center gap-2' : ''
        }`}
      >
        {option.icon ? <span className="shrink-0">{option.icon}</span> : null}
        <div className="min-w-0 max-w-full flex-1 overflow-hidden">
          <div className="block min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-left leading-4 font-medium text-gray-100">
            {option.label}
          </div>

          {shouldShowDetails ? (
            <div
              className={`flex min-w-0 max-w-full flex-col items-start gap-1 overflow-hidden ${
                compact || isCompactDensity ? 'text-[9px] leading-3' : 'text-xs'
              } ${isCompactDensity ? 'mt-0.5 text-gray-500' : 'mt-1 text-gray-400'}`}
            >
              {option.secondaryLabel ? (
                <div className="min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
                  {option.secondaryLabel}
                </div>
              ) : null}

              {hasBadges ? (
                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1 overflow-hidden">
                  {option.badges.map((badge, index) => (
                    <React.Fragment key={`${String(option.value)}-badge-${index}`}>
                      <Badge size="sm" variant="accent" shrink truncate className="max-w-[7rem]">
                        {badge}
                      </Badge>
                    </React.Fragment>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const activeDescendantId = visibleOptions[activeIndex]
    ? `dropdown-option-${String(visibleOptions[activeIndex].value).replace(/\s+/g, '-')}`
    : undefined;

  return (
    <div className={`${widthClass} min-w-0 max-w-full overflow-hidden`}>
      <Popover
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        triggerClassName="w-full"
        trigger={
          <button
            type="button"
            className={triggerButtonClasses}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
          >
            {selectedOption ? (
              renderOptionContent(selectedOption, true, showSelectedBadges)
            ) : (
              <span className="min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
                {placeholder}
              </span>
            )}

            <ChevronDown isOpen={isOpen} />
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
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleKeyDown}
                role="combobox"
                aria-expanded={isOpen}
                aria-haspopup="listbox"
                aria-autocomplete="list"
                aria-activedescendant={activeDescendantId}
                aria-controls="dropdown-listbox"
                placeholder="Search..."
                className="w-full min-w-0 rounded-lg border border-white/10 bg-gray-950/70 px-2.5 py-2 text-xs text-gray-100 outline-none transition placeholder:text-gray-600 focus:border-primary-400/60 focus:ring-2 focus:ring-primary-400/20"
              />
            ) : null}

            <ScrollArea axis="y" viewportClassName="max-h-[min(22rem,calc(100vh-9rem))] pr-1">
              <div
                id="dropdown-listbox"
                ref={optionsContainerRef}
                role="listbox"
                aria-label="Options"
                className="min-w-0 max-w-full space-y-1 overflow-hidden"
              >
                {visibleOptions.length > 0 ? (
                  visibleOptions.map((option, index) => (
                    <button
                      key={String(option.value)}
                      id={`dropdown-option-${String(option.value).replace(/\s+/g, '-')}`}
                      type="button"
                      role="option"
                      aria-selected={value === option.value}
                      onClick={() => {
                        onChange(option.value);
                        close();
                      }}
                      onMouseEnter={() => setActiveIndex(index)}
                      title={getOptionSearchText(option)}
                      className={`grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)_1rem] items-center overflow-hidden rounded-lg border-0 text-left transition-colors duration-150 focus:outline-none ${
                        isCompactDensity
                          ? 'gap-2 px-2 py-1.5 text-[11px]'
                          : 'gap-3 px-3 py-2 text-sm'
                      } ${
                        value === option.value
                          ? index === activeIndex
                            ? 'bg-primary-500/25 text-primary-50'
                            : 'bg-primary-500/20 text-primary-50 hover:bg-primary-500/25'
                          : index === activeIndex
                            ? 'bg-white/[0.09] text-gray-100'
                            : 'text-gray-300 hover:bg-white/[0.07]'
                      }`}
                    >
                      {renderOptionContent(option, isCompactDensity)}
                      <span
                        aria-hidden="true"
                        className={`grid h-4 w-4 place-items-center transition duration-150 ${
                          value === option.value
                            ? 'scale-100 text-primary-300 opacity-100'
                            : 'scale-75 opacity-0'
                        }`}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </span>
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
}

export default StyledDropdown;
