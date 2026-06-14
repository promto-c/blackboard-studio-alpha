import React from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SegmentOption {
  value: string | number;
  label: string;
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
  className?: string;
  style?: React.CSSProperties;
}

export interface SegmentedControlButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  activeClassName?: string;
  inactiveClassName?: string;
}

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const CONTROL_CLASS =
  'flex items-center gap-1 rounded-md border border-white/10 bg-black/20 p-0.5 text-[10px]';

const OPTIONS_CONTROL_CLASS = 'flex items-center gap-1 p-1 bg-gray-900 rounded-lg text-xs w-full';

const BUTTON_CLASS = 'px-2 py-1 tracking-wider font-semibold rounded transition-all';
const ACTIVE_BUTTON_CLASS = 'bg-gray-700 text-white shadow-sm';
const INACTIVE_BUTTON_CLASS = 'text-gray-500 hover:text-gray-300 hover:bg-white/5';

const OPTION_BUTTON_ACTIVE_CLASS =
  'flex-1 text-center px-2 py-1.5 rounded-md transition-colors duration-200 ease-in-out font-medium bg-gray-700 text-white shadow';
const OPTION_BUTTON_INACTIVE_CLASS =
  'flex-1 text-center px-2 py-1.5 rounded-md transition-colors duration-200 ease-in-out font-medium text-gray-400 hover:text-white';

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

  return <button type={type} className={classes} {...props} />;
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
  ({ options, value, onChange, children, className = '', style }, ref) => {
    // ── Options mode ──────────────────────────────────────────────────────
    if (options) {
      const resolvedValue = value;
      const resolvedOnChange = onChange;

      const classes = className ? `${OPTIONS_CONTROL_CLASS} ${className}` : OPTIONS_CONTROL_CLASS;

      return (
        <div ref={ref} className={classes} role="radiogroup" style={style}>
          {options.map((option) => {
            const active = resolvedValue === option.value;
            return (
              <button
                key={String(option.value)}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => resolvedOnChange?.(option.value)}
                className={active ? OPTION_BUTTON_ACTIVE_CLASS : OPTION_BUTTON_INACTIVE_CLASS}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      );
    }

    // ── Children mode ─────────────────────────────────────────────────────
    const classes = className ? `${CONTROL_CLASS} ${className}` : CONTROL_CLASS;

    return (
      <div ref={ref} className={classes} style={style}>
        {children}
      </div>
    );
  },
);

SegmentedControl.displayName = 'SegmentedControl';
