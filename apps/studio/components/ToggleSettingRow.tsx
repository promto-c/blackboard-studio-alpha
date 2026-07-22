import React from 'react';
import { ToggleSwitch, type ToggleSwitchProps } from '@blackboard/ui';
import { SettingRow } from './SettingRow';

export interface ToggleSettingRowProps extends Omit<ToggleSwitchProps, 'label'> {
  label: string;
  labelAccessory?: React.ReactNode;
  description?: React.ReactNode;
  rowClassName?: string;
}

/** Property toggle that always keeps its label and switch on one line. */
export function ToggleSettingRow({
  label,
  labelAccessory,
  description,
  rowClassName = '',
  ariaLabel = label,
  size = 'sm',
  ...toggleProps
}: ToggleSettingRowProps) {
  return (
    <div className="space-y-1">
      <SettingRow label={label} labelAccessory={labelAccessory} className={rowClassName}>
        <ToggleSwitch {...toggleProps} ariaLabel={ariaLabel} size={size} />
      </SettingRow>
      {description ? <p className="text-[10px] text-gray-500">{description}</p> : null}
    </div>
  );
}
