import React from 'react';
import * as Icons from '@blackboard/icons';

interface ViewportToolButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: React.ReactNode;
  isActive?: boolean;
  onSettingsClick?: () => void;
  isSettingsActive?: boolean;
}

const ViewportToolButton = React.forwardRef<HTMLButtonElement, ViewportToolButtonProps>(
  (
    {
      label,
      icon,
      isActive,
      className,
      onSettingsClick,
      isSettingsActive = false,
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

    const settingsVisibilityClasses =
      'pointer-events-none scale-95 -translate-x-2.5 opacity-0 group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:scale-100 group-hover:opacity-100';

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
          'absolute left-11 top-1/2 z-20 flex h-8 w-4 -translate-y-1/2 items-center justify-center rounded-r-md border border-transparent bg-transparent transition-all duration-150 focus:outline-none',
          isSettingsActive ? 'bg-primary-500/20 text-white' : 'text-gray-300 hover:bg-white/10',
          settingsVisibilityClasses,
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
        ].join(' ')}
      >
        <Icons.ChevronLeft className={`h-3.5 w-3.5 ${isSettingsActive ? '' : 'rotate-180'}`} />
      </button>
    );

    return (
      <div className={`group relative flex w-9 items-center justify-center ${className}`}>
        <span
          aria-hidden="true"
          className={[
            'pointer-events-none absolute -right-1.5 top-1/2 z-20 h-6 w-0.5 -translate-y-1/2 rounded-full transition-all duration-150',
            isSettingsActive
              ? 'bg-primary-300/40 shadow-[0_0_10px_rgba(96,165,250,0.45)]'
              : 'bg-white/20 group-hover:bg-white/40',
          ].join(' ')}
        />
        <span
          aria-hidden="true"
          className="absolute left-5 top-1/2 z-10 h-9 w-6 -translate-y-1/2"
        />
        {actionButton}
        {settingsButton}
      </div>
    );
  },
);

export default ViewportToolButton;
