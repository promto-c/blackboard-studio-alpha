import { useEffect, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import * as Icons from '@blackboard/icons';
import { Popover } from '@blackboard/ui';

const joinClasses = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

export interface SplitButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'disabled' | 'onClick'
> {
  children: ReactNode;
  onClick: () => void;
  menu: ReactNode | ((close: () => void) => ReactNode);
  menuLabel: string;
  actionDisabled?: boolean;
  menuDisabled?: boolean;
  menuWidthClass?: string;
  className?: string;
}

/** A primary action paired with a separate popover trigger for related settings or actions. */
export function SplitButton({
  children,
  onClick,
  menu,
  menuLabel,
  actionDisabled = false,
  menuDisabled = false,
  menuWidthClass = 'w-64',
  className,
  ...buttonProps
}: SplitButtonProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    if (menuDisabled) setIsMenuOpen(false);
  }, [menuDisabled]);

  return (
    <div
      className={joinClasses(
        'inline-flex shrink-0 overflow-hidden rounded-md border border-gray-700 bg-gray-800 transition focus-within:ring-2 focus-within:ring-primary-400/50 hover:border-gray-600',
        className,
      )}
    >
      <button
        type="button"
        disabled={actionDisabled}
        onClick={() => {
          setIsMenuOpen(false);
          onClick();
        }}
        className="px-2.5 py-1.5 text-xs font-medium text-gray-200 transition hover:bg-gray-700 focus-visible:outline-none disabled:cursor-not-allowed disabled:text-gray-500"
        {...buttonProps}
      >
        {children}
      </button>
      <Popover
        isOpen={menuDisabled ? false : isMenuOpen}
        onOpenChange={(open) => {
          if (!menuDisabled) setIsMenuOpen(open);
        }}
        align="end"
        widthClass={menuWidthClass}
        trigger={
          <button
            type="button"
            disabled={menuDisabled}
            aria-label={menuLabel}
            title={menuLabel}
            className={joinClasses(
              'inline-flex items-center justify-center border-l border-gray-700 px-1.5 text-gray-400 transition hover:bg-gray-700 hover:text-gray-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:text-gray-600',
              isMenuOpen && 'bg-gray-700 text-gray-100',
            )}
          >
            <Icons.ChevronDown className="h-3.5 w-3.5" />
          </button>
        }
      >
        {menu}
      </Popover>
    </div>
  );
}
