import React, { useLayoutEffect, useRef } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SegmentOption {
  value: string | number;
  label: string;
  /** Optional supporting text rendered below the primary label. */
  description?: React.ReactNode;
  /** Accessible name when the visible label and description should not be combined. */
  ariaLabel?: string;
  disabled?: boolean;
  title?: string;
}

export interface SegmentedControlProps {
  /** Simple options mode: array of { value, label } segments. */
  options?: SegmentOption[];
  /** Active value (required in options mode). */
  value?: string | number;
  /** Change handler (required in options mode). */
  onChange?: (value: string | number) => void;
  /** Children mode: render raw buttons (alternative to options). */
  children?: React.ReactNode;
  /** Accessible name for the group. */
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}

export interface SegmentedControlButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  activeClassName?: string;
  inactiveClassName?: string;
}

export type SegmentedControlActionProps = React.ButtonHTMLAttributes<HTMLButtonElement>;
export type SegmentedControlSeparatorProps = React.HTMLAttributes<HTMLSpanElement>;

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const CONTROL_CLASS =
  'bb-control-well bb-segmented-control relative inline-flex items-center gap-1 rounded-md border border-white/10 bg-black/20 p-0.5 text-[10px]';

const OPTIONS_CONTROL_CLASS =
  'bb-control-well bb-segmented-control relative flex w-full items-center gap-1 rounded-lg bg-gray-900 p-1 text-xs';

const BUTTON_CLASS =
  'bb-segmented-button rounded px-2 py-1 font-semibold tracking-wider transition-all';
const ACTIVE_BUTTON_CLASS = 'bb-segmented-active bg-gray-700 text-white shadow-sm';
const INACTIVE_BUTTON_CLASS =
  'bb-segmented-inactive text-gray-500 hover:bg-white/5 hover:text-gray-300';

const OPTION_BUTTON_ACTIVE_CLASS =
  'bb-segmented-button bb-segmented-active flex min-w-0 flex-1 flex-col items-center justify-center rounded-md bg-gray-700 px-2 py-1.5 text-center font-medium text-white shadow transition-colors duration-200 ease-in-out';
const OPTION_BUTTON_INACTIVE_CLASS =
  'bb-segmented-button bb-segmented-inactive flex min-w-0 flex-1 flex-col items-center justify-center rounded-md px-2 py-1.5 text-center font-medium text-gray-400 transition-colors duration-200 ease-in-out hover:text-white';
const OPTION_BUTTON_DISABLED_CLASS =
  'bb-segmented-button relative z-[1] flex min-w-0 flex-1 cursor-not-allowed flex-col items-center justify-center rounded-md px-2 py-1.5 text-center font-medium text-gray-600 opacity-55';

// ---------------------------------------------------------------------------
// SegmentedControlButton
// ---------------------------------------------------------------------------

export function SegmentedControlButton({
  active = false,
  activeClassName = ACTIVE_BUTTON_CLASS,
  inactiveClassName = INACTIVE_BUTTON_CLASS,
  className = '',
  type = 'button',
  ...props
}: SegmentedControlButtonProps) {
  const stateClassName = active ? activeClassName : inactiveClassName;
  const classes = `${BUTTON_CLASS} ${stateClassName}${className ? ` ${className}` : ''}`;

  return (
    <button
      type={type}
      className={classes}
      data-segment-active={active ? 'true' : undefined}
      data-segment-item
      {...props}
    />
  );
}

export const SegmentedControlAction = React.forwardRef<
  HTMLButtonElement,
  SegmentedControlActionProps
>(({ className = '', type = 'button', ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={`bb-segmented-action relative z-10 inline-flex h-full aspect-square shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-400/60${className ? ` ${className}` : ''}`}
    data-segment-action
    {...props}
  />
));

SegmentedControlAction.displayName = 'SegmentedControlAction';

export function SegmentedControlSeparator({
  className = '',
  ...props
}: SegmentedControlSeparatorProps) {
  return (
    <span
      aria-hidden="true"
      className={`bb-segmented-separator relative z-10 h-4 w-px shrink-0 self-center bg-white/10${className ? ` ${className}` : ''}`}
      role="separator"
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// SegmentedControl (unified)
// ---------------------------------------------------------------------------

/**
 * Unified segmented control component supporting two modes:
 *
 * **Options mode** (simple API):
 * ```tsx
 * <SegmentedControl
 *   options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]}
 *   value="a"
 *   onChange={(v) => ...}
 * />
 * ```
 *
 * **Children mode** (flexible API):
 * ```tsx
 * <SegmentedControl className="flex-1 gap-0.5 rounded-md border-0 bg-black/20">
 *   <SegmentedControlButton active>Tab 1</SegmentedControlButton>
 *   <SegmentedControlButton>Tab 2</SegmentedControlButton>
 * </SegmentedControl>
 * ```
 */
export const SegmentedControl = React.forwardRef<HTMLDivElement, SegmentedControlProps>(
  ({ options, value, onChange, children, ariaLabel, className = '', style }, ref) => {
    const controlRef = useRef<HTMLDivElement>(null);
    const previousLeftRef = useRef<number | null>(null);
    const movementTimerRef = useRef<number | null>(null);

    useLayoutEffect(
      () => () => {
        if (movementTimerRef.current !== null) window.clearTimeout(movementTimerRef.current);
      },
      [],
    );

    useLayoutEffect(() => {
      const control = controlRef.current;
      if (!control) return;

      const updateIndicator = () => {
        const activeItem = control.querySelector<HTMLElement>('[data-segment-active="true"]');
        if (!activeItem) {
          control.dataset.segmentSelectionVisible = 'false';
          previousLeftRef.current = null;
          return;
        }

        const nextLeft = activeItem.offsetLeft;
        const previousLeft = previousLeftRef.current;
        control.style.setProperty('--bb-segment-indicator-x', `${nextLeft}px`);
        control.style.setProperty('--bb-segment-indicator-width', `${activeItem.offsetWidth}px`);
        control.dataset.segmentSelectionVisible = 'true';

        if (previousLeft !== null && Math.abs(previousLeft - nextLeft) > 0.5) {
          control.dataset.segmentMoving = 'true';
          control.dataset.segmentDirection = nextLeft > previousLeft ? 'forward' : 'backward';
          if (movementTimerRef.current !== null) window.clearTimeout(movementTimerRef.current);
          movementTimerRef.current = window.setTimeout(() => {
            delete control.dataset.segmentMoving;
            movementTimerRef.current = null;
          }, 420);
        }
        previousLeftRef.current = nextLeft;
      };

      updateIndicator();
      const frame = window.requestAnimationFrame(updateIndicator);
      const resizeObserver =
        typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateIndicator);
      resizeObserver?.observe(control);
      control
        .querySelectorAll<HTMLElement>('[data-segment-item]')
        .forEach((item) => resizeObserver?.observe(item));

      return () => {
        window.cancelAnimationFrame(frame);
        resizeObserver?.disconnect();
      };
    }, [children, options, value]);

    const setControlRef = (node: HTMLDivElement | null) => {
      controlRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    };

    const selectionIndicator = (
      <span
        className="bb-segmented-selection-indicator"
        aria-hidden="true"
        data-testid="segment-indicator"
      />
    );

    // ── Options mode ──────────────────────────────────────────────────────
    if (options) {
      const resolvedValue = value;
      const resolvedOnChange = onChange;

      const classes = className ? `${OPTIONS_CONTROL_CLASS} ${className}` : OPTIONS_CONTROL_CLASS;

      return (
        <div
          ref={setControlRef}
          className={classes}
          role="radiogroup"
          aria-label={ariaLabel}
          style={style}
        >
          {selectionIndicator}
          {options.map((option) => {
            const active = !option.disabled && resolvedValue === option.value;
            return (
              <button
                key={String(option.value)}
                type="button"
                role="radio"
                aria-checked={active}
                aria-disabled={option.disabled || undefined}
                aria-label={option.ariaLabel}
                disabled={option.disabled}
                data-segment-active={active ? 'true' : undefined}
                data-segment-item
                onClick={() => resolvedOnChange?.(option.value)}
                className={
                  option.disabled
                    ? OPTION_BUTTON_DISABLED_CLASS
                    : active
                      ? OPTION_BUTTON_ACTIVE_CLASS
                      : OPTION_BUTTON_INACTIVE_CLASS
                }
                title={option.title}
              >
                <span className="block max-w-full truncate">{option.label}</span>
                {option.description !== undefined ? (
                  <span className="mt-0.5 block max-w-full truncate font-mono text-[11px] font-normal text-gray-500">
                    {option.description}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      );
    }

    // ── Children mode ─────────────────────────────────────────────────────
    const classes = className ? `${CONTROL_CLASS} ${className}` : CONTROL_CLASS;

    return (
      <div ref={setControlRef} className={classes} aria-label={ariaLabel} style={style}>
        {selectionIndicator}
        {children}
      </div>
    );
  },
);

SegmentedControl.displayName = 'SegmentedControl';
