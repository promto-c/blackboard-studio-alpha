import React from 'react';

export interface ToggleSwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: React.ReactNode;
  description?: React.ReactNode;
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  trackClassName?: string;
  thumbClassName?: string;
}

const sizeClasses = {
  sm: {
    track: 'h-4 w-7',
    thumb: 'h-3 w-3',
    checked: 'translate-x-3.5',
    unchecked: 'translate-x-0.5',
  },
  md: {
    track: 'h-6 w-11',
    thumb: 'h-4 w-4',
    checked: 'translate-x-6',
    unchecked: 'translate-x-1',
  },
} as const;

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onCheckedChange,
  label,
  description,
  ariaLabel,
  title,
  disabled,
  size = 'md',
  trackClassName,
  thumbClassName,
}) => {
  const labelId = React.useId();
  const descriptionId = React.useId();
  const hasLabel = label !== undefined && label !== null;
  const hasDescription = description !== undefined && description !== null;
  const descriptionTitle = typeof description === 'string' ? description : undefined;
  const classes = sizeClasses[size];

  const button = (
    <button
      type="button"
      onClick={() => onCheckedChange(!checked)}
      disabled={disabled}
      title={title}
      role="switch"
      aria-checked={checked}
      aria-label={hasLabel ? undefined : ariaLabel}
      aria-labelledby={hasLabel ? labelId : undefined}
      aria-describedby={hasDescription ? descriptionId : undefined}
    >
      <span
        className={[
          'relative inline-flex items-center rounded-full transition-colors',
          checked ? 'bg-primary-600' : 'bg-gray-600',
          classes.track,
          trackClassName,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span
          className={[
            'inline-block transform rounded-full bg-white transition-transform',
            classes.thumb,
            checked ? classes.checked : classes.unchecked,
            thumbClassName,
          ]
            .filter(Boolean)
            .join(' ')}
        />
      </span>
    </button>
  );

  if (!hasLabel) {
    if (hasDescription) {
      return (
        <div className="flex items-center justify-between gap-3">
          <span
            id={descriptionId}
            title={descriptionTitle}
            className="min-w-0 flex-1 truncate text-[11px] leading-4 text-gray-500"
          >
            {description}
          </span>
          {button}
        </div>
      );
    }

    return button;
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span
          id={labelId}
          className="max-w-[45%] shrink-0 truncate text-xs font-medium text-gray-400"
        >
          {label}
        </span>
        {hasDescription && (
          <span
            id={descriptionId}
            title={descriptionTitle}
            className="min-w-0 flex-1 truncate text-[11px] leading-4 text-gray-500"
          >
            {description}
          </span>
        )}
      </span>
      {button}
    </div>
  );
};

export default ToggleSwitch;
