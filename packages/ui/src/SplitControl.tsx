import React from 'react';

const joinClasses = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

export type SplitControlProps = React.HTMLAttributes<HTMLDivElement> & {
  density?: 'default' | 'toolbar';
};
export type SplitControlActionProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export function SplitControl({ className, density = 'default', ...props }: SplitControlProps) {
  return (
    <div
      className={joinClasses(
        'bb-dropdown-surface bb-split-control inline-flex min-w-0 items-stretch overflow-hidden rounded-lg',
        density === 'toolbar' && 'bb-control-toolbar',
        className,
      )}
      {...props}
    />
  );
}

export const SplitControlAction = React.forwardRef<HTMLButtonElement, SplitControlActionProps>(
  ({ children, className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={joinClasses(
        'bb-split-control-action relative z-10 inline-flex min-h-9 w-9 shrink-0 items-center justify-center text-gray-400 transition-colors hover:text-white focus-visible:outline-none',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="bb-split-control-separator pointer-events-none absolute bottom-1/4 left-0 top-1/4 z-20 w-px bg-white/10"
      />
      {children}
    </button>
  ),
);

SplitControlAction.displayName = 'SplitControlAction';
