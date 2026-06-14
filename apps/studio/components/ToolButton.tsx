import React from 'react';
import { usePreferences } from '@/state/preferencesContext';

export function ToolButton({
  label,
  icon,
  onClick,
  onMouseEnter,
  onMouseLeave,
  disabled = false,
  badge,
  title,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  disabled?: boolean;
  badge?: string;
  title?: string;
}) {
  const { incrementToolUsage } = usePreferences();

  const handleClick = () => {
    incrementToolUsage(label);
    onClick();
  };

  return (
    <button
      onClick={handleClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      disabled={disabled}
      title={title}
      className="relative flex flex-col items-center justify-center w-full gap-1 p-2 text-[10px] font-medium text-center text-gray-300 rounded-lg bg-gray-800 hover:bg-primary-900/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed aspect-square focus:outline-none"
    >
      <div className="w-6 h-6 flex items-center justify-center text-primary-400">{icon}</div>
      <span className="leading-tight truncate w-full">{label}</span>
      {badge && (
        <span className="absolute top-1 right-1 text-[10px] font-semibold text-purple-300 px-1 py-0.5 rounded-full border border-purple-500 bg-purple-900/30">
          {badge}
        </span>
      )}
    </button>
  );
}
