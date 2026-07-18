import React from 'react';
import * as Icons from '@blackboard/icons';

interface ViewportToolButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: React.ReactNode;
  isActive?: boolean;
  onSettingsClick?: React.MouseEventHandler<HTMLButtonElement>;
  isSettingsActive?: boolean;
  settingsPlacement?: 'right' | 'bottom';
}

const settingsPlacementClasses = {
  right: {
    visibility:
      'pointer-events-none scale-95 -translate-x-2.5 opacity-0 group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:scale-100 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-x-0 group-focus-within:scale-100 group-focus-within:opacity-100',
    button: 'left-11 top-1/2 h-8 w-4 -translate-y-1/2 rounded-r-md',
    indicator: '-right-1.5 top-1/2 h-6 w-0.5 -translate-y-1/2',
    bridge: 'left-full top-1/2 h-9 w-2 -translate-y-1/2',
  },
  bottom: {
    visibility:
      'pointer-events-none scale-95 -translate-y-2.5 opacity-0 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:scale-100 group-focus-within:opacity-100',
    button: 'left-1/2 top-11 h-4 w-8 -translate-x-1/2 rounded-b-md',
    indicator: '-bottom-1.5 left-1/2 h-0.5 w-6 -translate-x-1/2',
    bridge: 'left-1/2 top-full h-2 w-9 -translate-x-1/2',
  },
} as const;

export const ViewportToolButton = React.forwardRef<HTMLButtonElement, ViewportToolButtonProps>(
  (
    {
      label,
      icon,
      isActive,
      className,
      onSettingsClick,
      isSettingsActive = false,
      settingsPlacement = 'right',
      title,
      type = 'button',
      disabled = false,
      'aria-label': ariaLabel,
      ...props
    },
    ref,
  ) => {
    const primaryClasses = [
      'relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-md transition-colors',
      isActive
        ? 'bg-primary-500/20 text-white ring-1 ring-inset ring-primary-400/40 hover:bg-primary-500/30'
        : 'bg-transparent text-gray-300 hover:bg-white/10',
      disabled
        ? 'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent'
        : '',
    ]
      .filter(Boolean)
      .join(' ');

    if (!onSettingsClick) {
      return (
        <button
          ref={ref}
          type={type}
          disabled={disabled}
          title={title ?? label}
          aria-label={ariaLabel ?? label}
          aria-pressed={typeof isActive === 'boolean' ? isActive : undefined}
          className={`${primaryClasses} ${className}`}
          {...props}
        >
          {icon}
        </button>
      );
    }

    const resolvedSettingsLabel = `${isSettingsActive ? 'Hide' : 'Show'} settings`;
    const isBottomSettings = settingsPlacement === 'bottom';
    const placementClasses = settingsPlacementClasses[settingsPlacement];

    const actionButton = (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        title={title ?? label}
        aria-label={ariaLabel ?? label}
        aria-pressed={typeof isActive === 'boolean' ? isActive : undefined}
        className={primaryClasses}
        {...props}
      >
        {icon}
      </button>
    );

    const settingsButton = (
      <button
        type="button"
        disabled={disabled}
        title={resolvedSettingsLabel}
        aria-label={resolvedSettingsLabel}
        aria-pressed={isSettingsActive}
        onClick={onSettingsClick}
        className={[
          'absolute z-20 flex items-center justify-center border border-transparent bg-transparent transition-all duration-150 focus:outline-0 focus:outline-offset-0 focus-visible:bg-primary-500/20 focus-visible:text-white',
          placementClasses.button,
          isSettingsActive ? 'bg-primary-500/20 text-white' : 'text-gray-300 hover:bg-white/10',
          placementClasses.visibility,
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
        ].join(' ')}
      >
        {isBottomSettings ? (
          <Icons.ChevronDown className={`h-3.5 w-3.5 ${isSettingsActive ? 'rotate-180' : ''}`} />
        ) : (
          <Icons.ChevronLeft className={`h-3.5 w-3.5 ${isSettingsActive ? '' : 'rotate-180'}`} />
        )}
      </button>
    );

    return (
      <div className={`group relative flex w-9 items-center justify-center ${className}`}>
        <span
          aria-hidden="true"
          className={[
            'pointer-events-none absolute z-20 rounded-full transition-all duration-150',
            placementClasses.indicator,
            isSettingsActive
              ? 'bg-primary-300/40 shadow-[0_0_10px_rgba(96,165,250,0.45)]'
              : 'bg-white/20 group-hover:bg-white/40',
          ].join(' ')}
        />
        <span aria-hidden="true" className={`absolute z-10 ${placementClasses.bridge}`} />
        {actionButton}
        {settingsButton}
      </div>
    );
  },
);
