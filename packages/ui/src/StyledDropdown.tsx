import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, MagnifyingGlass } from '@blackboard/icons';
import { Badge } from './Badge';
import Popover from './Popover';
import ScrollArea from './ScrollArea';
import TextInput from './TextInput';

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

export interface DropdownOptionAction {
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  tone?: 'default' | 'danger';
}

export interface DropdownOption {
  value: string | number;
  label: React.ReactNode;
  icon?: React.ReactNode;
  secondaryLabel?: React.ReactNode;
  badges?: Array<React.ReactNode>;
  searchText?: string;
  trailingAction?: DropdownOptionAction;
}

export interface DropdownCreateOption {
  isAvailable: (query: string) => boolean;
  label: (query: string) => React.ReactNode;
  onCreate: (query: string) => void;
  icon?: React.ReactNode;
}

export interface StyledDropdownProps {
  value: string | number;
  options: DropdownOption[];
  onChange: (value: string | number) => void;
  density?: 'default' | 'compact' | 'toolbar';
  placeholder?: React.ReactNode;
  widthClass?: string;
  popoverWidthClass?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  createOption?: DropdownCreateOption;
  showSelectedBadges?: boolean;
  disabled?: boolean;
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
  searchPlaceholder = 'Search...',
  createOption,
  showSelectedBadges = true,
  disabled = false,
}: StyledDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionsContainerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((option) => option.value === value);
  const isCompactDensity = density !== 'default';
  const isToolbarDensity = density === 'toolbar';
  const shouldShowSearch = searchable ?? options.length > 8;
  const normalizedQuery = query.trim().toLowerCase();
  const createQuery = query.trim();
  const canCreateOption = Boolean(createQuery && createOption?.isAvailable(createQuery));

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
    if (!isOpen) return;
    const selectedIndex = visibleOptions.findIndex((option) => option.value === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [isOpen, value, visibleOptions]);

  useEffect(() => {
    if (!isOpen || visibleOptions.length === 0) return;
    const container = optionsContainerRef.current;
    if (!container) return;
    const activeButton = container.children[activeIndex] as HTMLElement | undefined;
    activeButton?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, isOpen, visibleOptions.length]);

  const applyOptionAtIndex = (index: number) => {
    const option = visibleOptions[index];
    if (!option) return;
    setActiveIndex(index);
    onChange(option.value);
  };

  const navigateAdjacentOption = (direction: 1 | -1) => {
    if (visibleOptions.length === 0) return;
    const selectedIndex = visibleOptions.findIndex((option) => option.value === value);
    const currentIndex = isOpen && visibleOptions[activeIndex] ? activeIndex : selectedIndex;
    const nextIndex =
      currentIndex < 0
        ? direction > 0
          ? 0
          : visibleOptions.length - 1
        : (currentIndex + direction + visibleOptions.length) % visibleOptions.length;
    if (isOpen) {
      setActiveIndex(nextIndex);
    } else {
      applyOptionAtIndex(nextIndex);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        if (visibleOptions.length === 0) return;
        event.preventDefault();
        navigateAdjacentOption(1);
        break;
      case 'ArrowUp':
        if (visibleOptions.length === 0) return;
        event.preventDefault();
        navigateAdjacentOption(-1);
        break;
      case 'Enter':
        if (!isOpen) return;
        event.preventDefault();
        if (canCreateOption && createOption) {
          createOption.onCreate(createQuery);
          setIsOpen(false);
          return;
        }
        if (visibleOptions[activeIndex]) {
          onChange(visibleOptions[activeIndex].value);
          setIsOpen(false);
        }
        break;
      case 'Tab':
        if (isOpen && visibleOptions[activeIndex]) {
          onChange(visibleOptions[activeIndex].value);
          setIsOpen(false);
        }
        break;
    }
  };

  const triggerButtonClasses = `bb-dropdown-trigger bb-dropdown-surface ${isToolbarDensity ? 'bb-control-toolbar' : ''} grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)_auto] items-center overflow-hidden rounded-lg border-0 text-left transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/30 disabled:cursor-not-allowed disabled:opacity-50 ${
    isToolbarDensity
      ? 'min-h-7 gap-1.5 px-1.5 py-1 font-sans text-[11px]'
      : isCompactDensity
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
        isOpen={isOpen && !disabled}
        onOpenChange={(nextOpen) => setIsOpen(disabled ? false : nextOpen)}
        triggerClassName="w-full"
        trigger={
          <button
            type="button"
            className={triggerButtonClasses}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            disabled={disabled}
            onKeyDown={handleKeyDown}
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
              <div className="group/dropdown-search relative">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-gray-500 transition-colors group-focus-within/dropdown-search:text-primary-300"
                >
                  <MagnifyingGlass className="h-3.5 w-3.5" />
                </span>
                <TextInput
                  ref={searchInputRef}
                  value={query}
                  onValueChange={(value) => {
                    setQuery(value);
                    setActiveIndex(0);
                  }}
                  onKeyDown={handleKeyDown}
                  role="combobox"
                  aria-expanded={isOpen}
                  aria-haspopup="listbox"
                  aria-autocomplete="list"
                  aria-activedescendant={activeDescendantId}
                  aria-controls="dropdown-listbox"
                  placeholder={searchPlaceholder}
                  className="pl-7"
                />
              </div>
            ) : null}

            {canCreateOption && createOption ? (
              <button
                type="button"
                onClick={() => {
                  createOption.onCreate(createQuery);
                  close();
                }}
                className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-primary-400/20 bg-primary-500/10 px-2 py-1.5 text-left text-[11px] text-primary-100 transition hover:bg-primary-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/30"
              >
                {createOption.icon ? <span className="shrink-0">{createOption.icon}</span> : null}
                <span className="min-w-0 flex-1 truncate">{createOption.label(createQuery)}</span>
              </button>
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
                    <div
                      key={String(option.value)}
                      onMouseEnter={() => setActiveIndex(index)}
                      className="group/dropdown-option flex min-w-0 max-w-full items-stretch overflow-hidden rounded-lg"
                    >
                      <button
                        id={`dropdown-option-${String(option.value).replace(/\s+/g, '-')}`}
                        type="button"
                        role="option"
                        aria-selected={value === option.value}
                        onClick={() => {
                          onChange(option.value);
                          close();
                        }}
                        title={getOptionSearchText(option)}
                        className={`grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_1rem] items-center overflow-hidden border-0 text-left transition-colors duration-150 focus:outline-none ${
                          isCompactDensity
                            ? 'gap-2 px-2 py-1.5 text-[11px]'
                            : 'gap-3 px-3 py-2 text-sm'
                        } ${
                          value === option.value
                            ? index === activeIndex
                              ? 'bg-primary-500/20 text-primary-50'
                              : 'bg-primary-500/15 text-primary-50 hover:bg-primary-500/20'
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
                      {option.trailingAction ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            option.trailingAction?.onSelect();
                          }}
                          title={option.trailingAction.label}
                          aria-label={option.trailingAction.label}
                          className={`flex w-7 shrink-0 items-center justify-center border-l border-white/[0.06] opacity-0 transition focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset group-hover/dropdown-option:opacity-100 ${
                            option.trailingAction.tone === 'danger'
                              ? 'text-gray-500 hover:bg-red-500/10 hover:text-red-200 focus-visible:ring-red-400/40'
                              : 'text-gray-500 hover:bg-white/[0.07] hover:text-gray-100 focus-visible:ring-primary-400/40'
                          }`}
                        >
                          {option.trailingAction.icon}
                        </button>
                      ) : null}
                    </div>
                  ))
                ) : !canCreateOption ? (
                  <div className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-xs text-gray-500">
                    No matches
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          </div>
        )}
      </Popover>
    </div>
  );
}

export default StyledDropdown;
