import React from 'react';
import { CONTROL_INPUT_SURFACE_CLASS } from './controlInputStyles';

export interface ColorInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'defaultValue' | 'onChange'
> {
  value: string;
  onValueChange: (value: string) => void;
}

const ColorInput = React.forwardRef<HTMLInputElement, ColorInputProps>(
  ({ value, onValueChange, className, ...props }, ref) => (
    <input
      {...props}
      ref={ref}
      type="color"
      value={value}
      onChange={(event) => onValueChange(event.currentTarget.value)}
      className={[`${CONTROL_INPUT_SURFACE_CLASS} h-9 w-12 shrink-0 cursor-pointer p-1`, className]
        .filter(Boolean)
        .join(' ')}
    />
  ),
);

ColorInput.displayName = 'ColorInput';

export default ColorInput;
