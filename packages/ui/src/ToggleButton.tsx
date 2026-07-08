import React from 'react';

export interface ToggleButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title?: string;
  disabled?: boolean;
  className?: string;
}

function ToggleButton({
  label,
  active,
  onClick,
  icon,
  title,
  disabled,
  className,
}: ToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-pressed={active}
      className={[
        'bb-control-button bb-toggle-button relative isolate flex flex-1 flex-col items-center justify-center overflow-hidden rounded border px-1 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/40',
        active
          ? 'border-primary-500 bg-primary-900/40 text-primary-200'
          : 'border-gray-700 bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-gray-800 disabled:hover:text-gray-400',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="relative z-[1] mb-0.5 h-4 w-4">{icon}</div>
      <span className="relative z-[1] text-[9px] font-medium uppercase tracking-wider">
        {label}
      </span>
    </button>
  );
}

export default ToggleButton;
