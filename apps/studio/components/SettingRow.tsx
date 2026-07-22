import React from 'react';

interface SettingRowProps {
  label: string;
  labelAccessory?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Reusable label-value layout row used in settings/inspector panels.
 * Renders the label above the control in narrow inspectors and switches to a
 * shared label/control grid when enough space is available.
 */
export function SettingRow({ label, labelAccessory, children, className = '' }: SettingRowProps) {
  return (
    <div className={`bb-responsive-setting-row ${className}`}>
      <div className="bb-responsive-setting-row__content text-xs">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <label className="truncate text-gray-400">{label}</label>
          {labelAccessory}
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
