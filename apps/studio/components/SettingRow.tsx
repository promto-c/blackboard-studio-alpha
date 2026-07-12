import React from 'react';

interface SettingRowProps {
  label: string;
  labelAccessory?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  layout?: 'inline' | 'responsive';
}

/**
 * Reusable label-value layout row used in settings/inspector panels.
 *
 * Rows stack the label above the control in narrow inspectors and switch to a
 * shared label/control grid when enough space is available. Use the inline
 * layout only for controls that must retain the compact legacy arrangement.
 */
export function SettingRow({
  label,
  labelAccessory,
  children,
  className = '',
  layout = 'responsive',
}: SettingRowProps) {
  if (layout === 'responsive') {
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

  return (
    <div className={`flex items-center justify-between gap-2 text-xs ${className}`}>
      <div className="flex min-w-0 items-center gap-2">
        <label className="truncate text-gray-400">{label}</label>
        {labelAccessory}
      </div>
      {children}
    </div>
  );
}
