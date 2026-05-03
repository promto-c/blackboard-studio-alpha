import React from 'react';
import ResetIconButton from './ResetIconButton';

export interface TextInputFieldProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'className' | 'onChange' | 'value'
> {
  label: React.ReactNode;
  description?: React.ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  onReset?: () => void;
  resetLabel?: string;
  resetTooltip?: string;
  containerClassName?: string;
  inputClassName?: string;
}

const TextInputField = React.forwardRef<HTMLInputElement, TextInputFieldProps>(
  (
    {
      label,
      description,
      value,
      onValueChange,
      onReset,
      resetLabel = 'Reset',
      resetTooltip,
      containerClassName,
      inputClassName,
      id,
      type = 'text',
      ...props
    },
    ref,
  ) => {
    const generatedInputId = React.useId();
    const descriptionId = React.useId();
    const inputId = id ?? generatedInputId;
    const hasDescription = description !== undefined && description !== null;
    const descriptionTitle = typeof description === 'string' ? description : undefined;

    return (
      <div className={['space-y-1.5', containerClassName].filter(Boolean).join(' ')}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <label
              htmlFor={inputId}
              className="max-w-[45%] shrink-0 truncate text-xs font-medium text-gray-400"
            >
              {label}
            </label>
            {hasDescription && (
              <span
                id={descriptionId}
                title={descriptionTitle}
                className="min-w-0 flex-1 truncate text-[11px] leading-4 text-gray-500"
              >
                {description}
              </span>
            )}
          </div>
          {onReset && (
            <ResetIconButton
              onClick={onReset}
              tooltip={
                resetTooltip ??
                `Reset ${typeof label === 'string' ? label : resetLabel.toLowerCase()} to its default value`
              }
            />
          )}
        </div>
        <input
          {...props}
          ref={ref}
          id={inputId}
          type={type}
          value={value}
          aria-describedby={hasDescription ? descriptionId : undefined}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          className={[
            'w-full min-w-0 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-gray-100 outline-none transition focus:border-primary-400/70 focus:ring-2 focus:ring-primary-400/20',
            inputClassName,
          ]
            .filter(Boolean)
            .join(' ')}
        />
      </div>
    );
  },
);

TextInputField.displayName = 'TextInputField';

export default TextInputField;
