import React from 'react';
import { Popover } from '@blackboard/ui';
import * as Icons from '@blackboard/icons';

const BATCH_RUN_COUNTS = [2, 4, 8, 16] as const;

export interface ComfyRunButtonGroupProps {
  disabled: boolean;
  runShortcutHint: string;
  onRun: () => void;
  onBatchRun: (count: number) => void;
  className?: string;
}

export function ComfyRunButtonGroup({
  disabled,
  runShortcutHint,
  onRun,
  onBatchRun,
  className,
}: ComfyRunButtonGroupProps) {
  const [isRunMenuOpen, setIsRunMenuOpen] = React.useState(false);

  React.useEffect(() => {
    if (disabled) {
      setIsRunMenuOpen(false);
    }
  }, [disabled]);

  return (
    <div
      className={[
        'inline-flex shrink-0 overflow-hidden rounded-md border border-primary-300/20 bg-primary-300/10 text-primary-100 transition hover:border-primary-300/40',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        onClick={() => {
          setIsRunMenuOpen(false);
          onRun();
        }}
        disabled={disabled}
        title={`Run workflow (${runShortcutHint})`}
        className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 px-2 py-1 text-[10px] font-medium transition hover:bg-primary-300/15 disabled:cursor-not-allowed disabled:bg-gray-900/70 disabled:text-gray-500"
      >
        <Icons.Play className="h-3.5 w-3.5" />
        Run
      </button>
      <Popover
        isOpen={disabled ? false : isRunMenuOpen}
        onOpenChange={(open) => {
          if (disabled) return;
          setIsRunMenuOpen(open);
        }}
        align="end"
        widthClass="w-36"
        trigger={
          <button
            type="button"
            disabled={disabled}
            className="relative inline-flex h-full items-center justify-center px-1.5 transition hover:bg-primary-300/15 before:pointer-events-none before:absolute before:left-0 before:top-1/2 before:h-3.5 before:w-px before:-translate-y-1/2 before:bg-primary-300/20 disabled:cursor-not-allowed disabled:bg-gray-900/70 disabled:text-gray-500 disabled:before:bg-gray-700"
            title="Run batch"
            aria-label="Run batch"
          >
            <Icons.ChevronDown className="h-3.5 w-3.5" />
          </button>
        }
      >
        {(closePopover) => (
          <div className="space-y-1">
            <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
              Batch Run
            </p>
            {BATCH_RUN_COUNTS.map((count) => (
              <button
                key={count}
                type="button"
                onClick={() => {
                  closePopover();
                  onBatchRun(count);
                }}
                className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs text-gray-300 transition hover:bg-white/[0.06] hover:text-white"
              >
                <span>{count} runs</span>
                <span className="font-mono text-[11px] text-gray-500">x{count}</span>
              </button>
            ))}
          </div>
        )}
      </Popover>
    </div>
  );
}
