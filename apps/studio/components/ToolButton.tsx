import React from 'react';
import { Badge } from '@blackboard/ui';
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
      type="button"
      onClick={handleClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      disabled={disabled}
      title={title}
      className="bb-segmented-surface-button relative isolate flex aspect-square w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-lg bg-gray-700 p-2 text-center text-[10px] font-medium text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none"
    >
      <div className="w-6 h-6 flex items-center justify-center text-primary-400">{icon}</div>
      <span className="leading-tight truncate w-full">{label}</span>
      {badge && (
        <Badge
          size="sm"
          variant="neutral"
          className="absolute top-1 right-1 border-purple-500 bg-purple-900/30 text-purple-300 font-semibold"
        >
          {badge}
        </Badge>
      )}
    </button>
  );
}
