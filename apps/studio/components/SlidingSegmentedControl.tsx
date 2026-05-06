import React from 'react';

import { StudioSegmentedControl } from './StudioSegmentedControl';

export interface SlidingSegmentedControlOption<T extends string> {
  value: T;
  label: string;
  Icon: React.FC<{ className?: string }>;
  title?: string;
  ariaLabel?: string;
}

export interface SlidingSegmentedControlProps<T extends string> {
  options: SlidingSegmentedControlOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  activeWidth?: number;
  inactiveWidth?: number;
  gap?: number;
  padding?: number;
  height?: React.CSSProperties['height'];
  className?: string;
  iconClassName?: string;
  labelMaxWidthClassName?: string;
  emptyState?: 'even' | 'compact';
}

const DEFAULT_ACTIVE_WIDTH = 76;
const DEFAULT_INACTIVE_WIDTH = 28;
const DEFAULT_GAP = 2;
const DEFAULT_PADDING = 4;
const DEFAULT_HEIGHT = 28;
const CONTROL_BORDER_WIDTH = 1;

const SlidingSegmentedControl = <T extends string>({
  options,
  value,
  onChange,
  activeWidth = DEFAULT_ACTIVE_WIDTH,
  inactiveWidth = DEFAULT_INACTIVE_WIDTH,
  gap = DEFAULT_GAP,
  padding = DEFAULT_PADDING,
  height = DEFAULT_HEIGHT,
  className = '',
  iconClassName = 'h-3.5 w-3.5',
  labelMaxWidthClassName = 'max-w-12',
  emptyState = 'even',
}: SlidingSegmentedControlProps<T>): React.JSX.Element => {
  const activeIndex = options.findIndex((option) => option.value === value);
  const itemGapTotal = gap * Math.max(0, options.length - 1);
  const innerWidth =
    activeWidth + inactiveWidth * Math.max(0, options.length - 1) + itemGapTotal + padding;
  const outerWidth = innerWidth + CONTROL_BORDER_WIDTH;
  const evenOptionWidth =
    options.length > 0 ? (innerWidth - padding - itemGapTotal) / options.length : 0;
  const tabInset = padding / 2;
  const indicatorLeft =
    activeIndex >= 0 ? tabInset + activeIndex * (inactiveWidth + gap) : tabInset;
  const showIndicator = activeIndex >= 0;
  const controlClassName = `relative${className ? ` ${className}` : ''}`;

  return (
    <StudioSegmentedControl
      className={controlClassName}
      style={{ width: outerWidth, height, gap: `${gap}px` }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0.5 bottom-0.5 rounded bg-gray-700 shadow-sm transition-[transform,opacity] duration-200 ease-out"
        style={{
          opacity: showIndicator ? 1 : 0,
          transform: `translateX(${indicatorLeft}px)`,
          width: activeWidth,
        }}
      />
      {options.map(({ value: optionValue, label, Icon, title, ariaLabel }) => {
        const active = value === optionValue;
        const itemWidth =
          activeIndex < 0 && emptyState === 'even'
            ? evenOptionWidth
            : active
              ? activeWidth
              : inactiveWidth;

        return (
          <button
            key={optionValue}
            type="button"
            onClick={() => onChange(optionValue)}
            className={`relative z-10 inline-flex h-full items-center justify-center overflow-hidden rounded px-1 py-1 text-[10px] font-semibold tracking-wide transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/60 ${
              active ? 'text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
            style={{ flex: '0 0 auto', width: itemWidth }}
            title={title ?? label}
            aria-label={ariaLabel ?? label}
          >
            <Icon className={`${iconClassName} flex-shrink-0`} />
            <span
              className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin] duration-200 ease-out ${
                active ? `ml-1 ${labelMaxWidthClassName} opacity-100` : 'ml-0 max-w-0 opacity-0'
              }`}
            >
              {label}
            </span>
          </button>
        );
      })}
    </StudioSegmentedControl>
  );
};

export default SlidingSegmentedControl;
