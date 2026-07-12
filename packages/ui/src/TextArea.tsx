import React from 'react';
import ResizableScrollTextarea, {
  type ResizableScrollTextareaProps,
} from './ResizableScrollTextarea';

export interface TextAreaProps extends Omit<
  ResizableScrollTextareaProps,
  'value' | 'defaultValue' | 'onChange'
> {
  value: string;
  onValueChange: (value: string) => void;
}

/**
 * The standard multiline counterpart to TextInput. It keeps long content
 * scrollable, grows with its content, and exposes an accessible resize handle.
 */
const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(
  (
    { value, onValueChange, minHeight = 36, maxHeight = 280, initialMaxHeight = 176, ...props },
    ref,
  ) => (
    <ResizableScrollTextarea
      {...props}
      ref={ref}
      value={value}
      onChange={(event) => onValueChange(event.currentTarget.value)}
      minHeight={minHeight}
      maxHeight={maxHeight}
      initialMaxHeight={initialMaxHeight}
    />
  ),
);

TextArea.displayName = 'TextArea';

export default TextArea;
