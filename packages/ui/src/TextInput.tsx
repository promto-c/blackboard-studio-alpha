import React from 'react';
import { DEFAULT_CONTROL_INPUT_CLASS } from './controlInputStyles';

export interface TextInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'defaultValue' | 'onChange'
> {
  value: string;
  onValueChange: (value: string) => void;
}

const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(
  ({ value, onValueChange, type = 'text', className, ...props }, ref) => (
    <input
      {...props}
      ref={ref}
      type={type}
      value={value}
      onChange={(event) => onValueChange(event.currentTarget.value)}
      className={[DEFAULT_CONTROL_INPUT_CLASS, 'placeholder:text-gray-500', className]
        .filter(Boolean)
        .join(' ')}
    />
  ),
);

TextInput.displayName = 'TextInput';

export default TextInput;
