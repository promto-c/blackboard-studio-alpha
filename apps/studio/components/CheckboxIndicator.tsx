import type { ReactNode } from 'react';
import * as Icons from '@blackboard/icons';

const joinClasses = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

export interface CheckboxIndicatorProps {
  checked: boolean;
  uncheckedIcon?: ReactNode;
  className?: string;
}

/** Shared visual indicator for native checkboxes and checkbox-like row actions. */
export function CheckboxIndicator({ checked, uncheckedIcon, className }: CheckboxIndicatorProps) {
  return (
    <span
      aria-hidden="true"
      className={joinClasses(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition peer-focus-visible:ring-2 peer-focus-visible:ring-primary-300/40 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-gray-900',
        checked
          ? 'border-primary-300/30 bg-primary-300/10 text-primary-100'
          : 'border-gray-700 text-gray-400',
        className,
      )}
    >
      {checked ? <Icons.Check className="h-2.5 w-2.5" /> : uncheckedIcon}
    </span>
  );
}
