import React from 'react';

interface SettingRowProps {
  label: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Reusable label-value layout row used in settings/inspector panels.
 *
 * Replaces repeated local `SettingRow` definitions in SceneAdjustments.tsx
 * and OutputAdjustments.tsx. Consumers can override the wrapper layout via
 * `className` to switch between flex/grid alignment as needed.
 */
export function SettingRow({ label, children, className = '' }: SettingRowProps) {
  return (
    <div className={`flex items-center justify-between gap-2 text-xs ${className}`}>
      <label className="whitespace-nowrap text-gray-400">{label}</label>
      {children}
    </div>
  );
}
