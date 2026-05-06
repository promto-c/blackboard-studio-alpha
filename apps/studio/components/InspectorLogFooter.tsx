import React from 'react';

export type InspectorLogFooterVariant = 'info' | 'error' | 'warning' | 'success';

export interface InspectorLogFooterProps {
  message?: React.ReactNode;
  label?: React.ReactNode;
  variant?: InspectorLogFooterVariant;
  progressIndeterminate?: boolean;
  progressLabel?: string;
  progressPercent?: number;
  actions?: React.ReactNode;
  className?: string;
  sticky?: boolean;
}

const variantClasses: Record<
  InspectorLogFooterVariant,
  { dot: string; label: string; message: string; panel: string; progress: string }
> = {
  info: {
    dot: 'bg-primary-300',
    label: 'text-primary-100/80',
    message: 'text-primary-50',
    panel: 'border-primary-300/20 bg-primary-400/[0.08]',
    progress: 'bg-primary-400/[0.14]',
  },
  error: {
    dot: 'bg-red-300',
    label: 'text-red-100/80',
    message: 'text-red-50',
    panel: 'border-red-300/25 bg-red-400/[0.09]',
    progress: 'bg-red-400/[0.16]',
  },
  warning: {
    dot: 'bg-amber-300',
    label: 'text-amber-100/80',
    message: 'text-amber-50',
    panel: 'border-amber-300/25 bg-amber-400/[0.08]',
    progress: 'bg-amber-400/[0.14]',
  },
  success: {
    dot: 'bg-emerald-300',
    label: 'text-emerald-100/80',
    message: 'text-emerald-50',
    panel: 'border-emerald-300/25 bg-emerald-400/[0.08]',
    progress: 'bg-emerald-400/[0.14]',
  },
};

const clampProgressPercent = (value: number): number => Math.min(100, Math.max(0, value));

const InspectorLogFooter: React.FC<InspectorLogFooterProps> = ({
  message,
  label = 'Log',
  variant = 'info',
  progressIndeterminate = false,
  progressLabel,
  progressPercent,
  actions,
  className = '',
  sticky = true,
}) => {
  const classes = variantClasses[variant];
  const hasProgress = progressIndeterminate || progressPercent !== undefined;
  if (!message && !hasProgress && !actions) return null;

  const progressWidth = progressPercent === undefined ? 100 : clampProgressPercent(progressPercent);
  const displayMessage = message ?? progressLabel ?? '';
  const messageTitle = typeof displayMessage === 'string' ? displayMessage : undefined;

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      aria-label={progressLabel}
      className={['relative z-20 overflow-hidden border-t px-3 py-1.5', classes.panel, className]
        .filter(Boolean)
        .join(' ')}
    >
      {hasProgress ? (
        <div
          className={`absolute inset-y-0 left-0 ${classes.progress} transition-all duration-300 ${
            progressIndeterminate ? 'animate-pulse' : ''
          }`}
          style={{ width: `${progressWidth}%` }}
          aria-hidden="true"
        />
      ) : null}
      <div className="relative flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${classes.dot}`} />
          <span
            className={`shrink-0 text-[10px] font-semibold uppercase leading-5 tracking-[0.12em] ${classes.label}`}
          >
            {label}
          </span>
          <div
            className={`min-w-0 truncate text-xs leading-5 ${classes.message}`}
            title={messageTitle}
          >
            {displayMessage}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">{actions}</div>
        ) : null}
      </div>
    </div>
  );
};

export default InspectorLogFooter;
