import type { ReactNode } from 'react';
import * as Icons from '@blackboard/icons';

export type PreferenceBentoIcon = React.ComponentType<{ className?: string }>;

export function PreferenceBentoCard({
  title,
  description,
  icon: Icon,
  headerAction,
  children,
  className = '',
}: {
  title: string;
  description: string;
  icon: PreferenceBentoIcon;
  headerAction?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_18px_50px_rgba(0,0,0,0.12)] ${className}`}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/[0.035] to-transparent" />
      <header className="relative flex items-start gap-3 border-b border-white/[0.07] px-4 py-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center text-gray-400">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            {headerAction}
          </div>
          <p className="mt-1 text-xs leading-5 text-gray-400">{description}</p>
        </div>
      </header>
      <div className="relative divide-y divide-white/[0.07] px-4">{children}</div>
    </section>
  );
}

export function PreferenceBentoControl({
  title,
  description,
  children,
  stacked = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div
      className={
        stacked ? 'py-4' : 'grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'
      }
    >
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-gray-100">{title}</p>
        <p className="mt-1 text-[11px] leading-5 text-gray-500">{description}</p>
      </div>
      <div className={stacked ? 'mt-3' : 'min-w-0 sm:max-w-[24rem]'}>{children}</div>
    </div>
  );
}

export function PreferenceBentoEmptyState({
  icon: Icon,
  children,
}: {
  icon: PreferenceBentoIcon;
  children: ReactNode;
}) {
  return (
    <div className="my-4 flex items-center gap-3 rounded-xl border border-dashed border-white/10 bg-black/10 px-3 py-3 text-xs leading-5 text-gray-500">
      <Icon className="h-4 w-4 shrink-0 text-gray-600" />
      <span>{children}</span>
    </div>
  );
}

export function PreferenceBentoResetButton({
  label,
  onReset,
  disabled = false,
}: {
  label: string;
  onReset: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onReset}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 transition hover:bg-white/[0.06] hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/50 disabled:cursor-default disabled:text-gray-700 disabled:hover:bg-transparent"
      aria-label={label}
      title={label}
    >
      <Icons.Reset className="h-3.5 w-3.5" />
    </button>
  );
}
