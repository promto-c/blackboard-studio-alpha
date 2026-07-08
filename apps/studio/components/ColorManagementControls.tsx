import type { ReactNode } from 'react';
import * as Icons from '@blackboard/icons';

const RESET_BUTTON_CLASS =
  'grid h-9 w-9 shrink-0 place-items-center rounded-lg text-gray-400 transition hover:bg-white/[0.08] hover:text-gray-100 disabled:cursor-default disabled:text-gray-700 disabled:hover:bg-transparent';

export interface ColorManagementControlSectionProps {
  title: string;
  children: ReactNode;
  onReset: () => void;
  resetDisabled?: boolean;
}

export function ColorManagementControlSection({
  title,
  children,
  onReset,
  resetDisabled = false,
}: ColorManagementControlSectionProps) {
  return (
    <section className="min-w-0 rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="mb-3 flex min-h-7 items-center justify-between gap-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          {title}
        </div>
        <button
          type="button"
          onClick={onReset}
          disabled={resetDisabled}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-gray-400 transition hover:bg-white/[0.07] hover:text-gray-100 disabled:cursor-default disabled:text-gray-700 disabled:hover:bg-transparent"
          aria-label={`Reset all ${title.toLowerCase()}`}
          title={`Reset all ${title.toLowerCase()}`}
        >
          Reset all
        </button>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export interface ColorManagementControlRowProps {
  label: string;
  children: ReactNode;
  onReset: () => void;
  resetDisabled?: boolean;
  issue?: string | null;
}

export function ColorManagementControlRow({
  label,
  children,
  onReset,
  resetDisabled = false,
  issue,
}: ColorManagementControlRowProps) {
  return (
    <div className="grid min-w-0 grid-cols-[7rem_minmax(0,1fr)_2.25rem] items-center gap-2">
      <div className="truncate text-xs text-gray-400">{label}</div>
      <div className="min-w-0">{children}</div>
      <button
        type="button"
        onClick={onReset}
        disabled={resetDisabled}
        title={`Reset ${label}`}
        aria-label={`Reset ${label}`}
        className={RESET_BUTTON_CLASS}
      >
        <Icons.Reset className="h-4 w-4" />
      </button>
      {issue ? <div className="col-span-3 text-xs text-red-200">{issue}</div> : null}
    </div>
  );
}
