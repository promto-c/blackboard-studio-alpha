import type { ButtonHTMLAttributes, ReactNode } from 'react';
import * as Icons from '@blackboard/icons';

const joinClasses = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

type ExecuteButtonVariant = 'compact' | 'prominent';

interface ExecuteButtonGroupProps {
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  fullWidth?: boolean;
  variant?: ExecuteButtonVariant;
}

export function ExecuteButtonGroup({
  children,
  disabled = false,
  className,
  fullWidth = false,
  variant = 'compact',
}: ExecuteButtonGroupProps) {
  return (
    <div
      className={joinClasses(
        'bb-control-button bb-execute-button group/execute relative inline-flex shrink-0 overflow-hidden border text-primary-50 transition duration-200 focus-within:ring-2 focus-within:ring-primary-200/65 focus-within:ring-offset-1 focus-within:ring-offset-gray-900',
        variant === 'prominent'
          ? 'bb-execute-prominent min-h-14 rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.10),inset_0_0_0_1px_rgba(255,255,255,0.035),0_10px_28px_rgba(0,0,0,0.18)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.13),inset_0_0_0_1px_rgba(255,255,255,0.05),0_14px_34px_rgba(20,184,166,0.12)]'
          : 'bb-execute-compact min-h-7 rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.10),inset_0_0_0_1px_rgba(255,255,255,0.025),0_5px_16px_rgba(0,0,0,0.14)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.13),inset_0_0_0_1px_rgba(255,255,255,0.04),0_7px_20px_rgba(20,184,166,0.10)]',
        disabled
          ? 'translate-y-0 border-white/[0.07] bg-white/[0.035] text-gray-500 shadow-none'
          : 'border-primary-200/30 bg-gradient-to-b from-primary-300/[0.22] via-primary-400/[0.13] to-primary-600/[0.11] hover:border-primary-200/45 hover:from-primary-300/[0.28] hover:via-primary-400/[0.17] hover:to-primary-600/[0.14]',
        fullWidth && 'w-full',
        className,
      )}
      data-disabled={disabled ? 'true' : undefined}
    >
      <span
        className={joinClasses(
          'bb-execute-sheen pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.045] to-transparent transition',
          disabled ? 'opacity-0' : 'opacity-80 group-hover/execute:opacity-100',
        )}
      />
      {variant === 'prominent' ? (
        <span
          className={joinClasses(
            'bb-execute-orb pointer-events-none absolute -right-10 -top-14 h-32 w-32 rounded-full blur-2xl transition',
            disabled
              ? 'bg-transparent'
              : 'bg-primary-300/[0.16] group-hover/execute:bg-primary-300/[0.24]',
          )}
        />
      ) : null}
      {children}
    </div>
  );
}

interface ExecuteButtonActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  icon?: ReactNode | false;
  trailingIcon?: ReactNode;
  variant?: ExecuteButtonVariant;
}

export function ExecuteButtonAction({
  children,
  icon,
  trailingIcon,
  variant = 'compact',
  className,
  disabled,
  ...buttonProps
}: ExecuteButtonActionProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={joinClasses(
        'group/action relative z-[1] inline-flex min-w-0 flex-1 items-center font-semibold transition duration-200 hover:bg-primary-200/[0.07] active:bg-primary-200/[0.11] disabled:text-gray-500 disabled:[&>svg]:text-gray-600',
        variant === 'prominent'
          ? 'gap-3 px-3.5 py-2.5 text-left text-sm'
          : 'justify-center gap-1.5 px-2.5 py-1.5 text-[10px]',
        className,
      )}
      {...buttonProps}
    >
      {icon === undefined ? (
        <Icons.Play className="h-3.5 w-3.5 shrink-0 text-primary-200 transition group-hover/execute:text-primary-100" />
      ) : (
        icon
      )}
      {children}
      {trailingIcon ? (
        <span className="inline-flex shrink-0 transition-transform duration-200 ease-out group-hover/action:translate-x-0.5 group-focus-visible/action:translate-x-0.5 group-active/action:translate-x-0 group-disabled/action:translate-x-0 motion-reduce:transform-none">
          {trailingIcon}
        </span>
      ) : null}
    </button>
  );
}

export function ExecuteButtonMenuTrigger({
  className,
  disabled,
  ...buttonProps
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={joinClasses(
        'relative z-[1] inline-flex min-h-full items-center justify-center border-l border-primary-200/15 px-1.5 text-primary-200 transition duration-200 hover:bg-primary-200/[0.08] hover:text-primary-100 active:bg-primary-200/[0.12] disabled:border-white/[0.06] disabled:text-gray-600',
        className,
      )}
      {...buttonProps}
    >
      <Icons.ChevronDown className="h-3.5 w-3.5" />
    </button>
  );
}

interface ExecuteButtonProps extends ExecuteButtonActionProps {
  fullWidth?: boolean;
  actionClassName?: string;
}

export function ExecuteButton({
  fullWidth = false,
  actionClassName,
  disabled,
  className,
  variant = 'compact',
  ...buttonProps
}: ExecuteButtonProps) {
  return (
    <ExecuteButtonGroup
      disabled={disabled}
      fullWidth={fullWidth}
      className={className}
      variant={variant}
    >
      <ExecuteButtonAction
        disabled={disabled}
        className={actionClassName}
        variant={variant}
        {...buttonProps}
      />
    </ExecuteButtonGroup>
  );
}

interface ExecuteMenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  meta?: ReactNode;
  icon?: ReactNode;
}

export function ExecuteMenuItem({
  label,
  meta,
  icon,
  className,
  ...buttonProps
}: ExecuteMenuItemProps) {
  return (
    <button
      type="button"
      className={joinClasses(
        'group/execute-item flex w-full items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-left text-xs text-gray-300 transition duration-150 hover:border-primary-300/15 hover:bg-gradient-to-b hover:from-primary-300/[0.1] hover:to-primary-500/[0.05] hover:text-primary-50 focus-visible:ring-2 focus-visible:ring-primary-200/50 disabled:text-gray-600',
        className,
      )}
      {...buttonProps}
    >
      {icon ?? (
        <Icons.Play className="h-3 w-3 shrink-0 text-gray-500 transition group-hover/execute-item:text-primary-300" />
      )}
      <span className="min-w-0 flex-1">{label}</span>
      {meta ? <span className="font-mono text-[11px] text-gray-500">{meta}</span> : null}
    </button>
  );
}
