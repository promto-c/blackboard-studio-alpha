import React from 'react';

import { SegmentedControl } from './SegmentedControl';

export interface SlidingSegmentedControlOption<T extends string> {
  value: T;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  title?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

export interface SlidingSegmentedControlProps<T extends string> {
  options: SlidingSegmentedControlOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  activeWidth?: number;
  inactiveWidth?: number;
  gap?: number;
  padding?: number;
  /** Visual silhouette for the track and its segments. */
  shape?: 'rounded' | 'pill';
  selectionRadius?: React.CSSProperties['borderRadius'];
  height?: React.CSSProperties['height'];
  className?: string;
  ariaLabel?: string;
  itemClassName?: string;
  iconClassName?: string;
  activeIconClassName?: string;
  inactiveIconClassName?: string;
  labelMaxWidthClassName?: string;
  emptyState?: 'even' | 'compact';
  children?: React.ReactNode;
}

const DEFAULT_ACTIVE_WIDTH = 64;
const DEFAULT_INACTIVE_WIDTH = 28;
const DEFAULT_GAP = 2;
const DEFAULT_PADDING = 6;
const DEFAULT_HEIGHT = 28;
const CONTROL_BORDER_WIDTH = 1;
const PILL_RADIUS = 9999;

export const SlidingSegmentedControl = <T extends string>({
  options,
  value,
  onChange,
  activeWidth = DEFAULT_ACTIVE_WIDTH,
  inactiveWidth = DEFAULT_INACTIVE_WIDTH,
  gap = DEFAULT_GAP,
  padding = DEFAULT_PADDING,
  shape = 'rounded',
  selectionRadius,
  height = DEFAULT_HEIGHT,
  className = '',
  ariaLabel,
  itemClassName = '',
  iconClassName = 'h-3.5 w-3.5',
  activeIconClassName = '',
  inactiveIconClassName = '',
  labelMaxWidthClassName = 'max-w-12',
  emptyState = 'even',
  children,
}: SlidingSegmentedControlProps<T>): React.JSX.Element => {
  const activeIndex = options.findIndex((option) => option.value === value);
  const itemGapTotal = gap * Math.max(0, options.length - 1);
  const innerWidth =
    activeWidth + inactiveWidth * Math.max(0, options.length - 1) + itemGapTotal + padding;
  const outerWidth = innerWidth + CONTROL_BORDER_WIDTH;
  const evenOptionWidth =
    options.length > 0 ? (innerWidth - padding - itemGapTotal) / options.length : 0;
  const hasAccessories = React.Children.count(children) > 0;
  const controlClassName = `bb-sliding-segmented-control bb-segmented-control-compact relative${className ? ` ${className}` : ''}`;
  const controlRadius = shape === 'pill' ? PILL_RADIUS : undefined;
  const resolvedSelectionRadius = selectionRadius ?? controlRadius;

  return (
    <SegmentedControl
      className={controlClassName}
      ariaLabel={ariaLabel}
      style={
        {
          width: hasAccessories ? undefined : outerWidth,
          height,
          gap: `${gap}px`,
          padding: `${padding / 2}px`,
          borderRadius: controlRadius,
          '--bb-sliding-segment-inset': `${padding / 2}px`,
          '--bb-sliding-segment-radius':
            typeof resolvedSelectionRadius === 'number'
              ? `${resolvedSelectionRadius}px`
              : resolvedSelectionRadius,
        } as React.CSSProperties
      }
    >
      {options.map(({ value: optionValue, label, Icon, title, ariaLabel, disabled }) => {
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
            disabled={disabled}
            data-segment-active={active ? 'true' : undefined}
            data-segment-item
            className={`bb-sliding-segmented-button bb-segmented-button relative z-10 inline-flex h-full items-center justify-center overflow-hidden rounded px-1 py-1 text-[10px] font-semibold tracking-wide transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/60 disabled:cursor-not-allowed disabled:text-gray-700 ${
              active
                ? 'text-white'
                : 'text-gray-500 hover:text-gray-300 disabled:hover:text-gray-700'
            }${itemClassName ? ` ${itemClassName}` : ''}`}
            style={{ flex: '0 0 auto', width: itemWidth, borderRadius: controlRadius }}
            title={title ?? label}
            aria-label={ariaLabel ?? label}
          >
            <Icon
              className={`${iconClassName} flex-shrink-0 ${
                active ? activeIconClassName : inactiveIconClassName
              }`}
            />
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
      {children}
    </SegmentedControl>
  );
};
