import React from 'react';
import { Popover } from '@blackboard/ui';
import {
  ExecuteButtonAction,
  ExecuteButtonGroup,
  ExecuteButtonMenuTrigger,
  ExecuteMenuItem,
} from '@/components';

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
    <ExecuteButtonGroup disabled={disabled} className={className}>
      <ExecuteButtonAction
        onClick={() => {
          setIsRunMenuOpen(false);
          onRun();
        }}
        disabled={disabled}
        title={`Run workflow (${runShortcutHint})`}
      >
        Run
      </ExecuteButtonAction>
      <Popover
        isOpen={disabled ? false : isRunMenuOpen}
        onOpenChange={(open) => {
          if (disabled) return;
          setIsRunMenuOpen(open);
        }}
        align="end"
        widthClass="w-36"
        trigger={
          <ExecuteButtonMenuTrigger disabled={disabled} title="Run batch" aria-label="Run batch" />
        }
      >
        {(closePopover) => (
          <div className="space-y-1">
            <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
              Batch Run
            </p>
            {BATCH_RUN_COUNTS.map((count) => (
              <ExecuteMenuItem
                key={count}
                onClick={() => {
                  closePopover();
                  onBatchRun(count);
                }}
                label={`${count} runs`}
                meta={`×${count}`}
              />
            ))}
          </div>
        )}
      </Popover>
    </ExecuteButtonGroup>
  );
}
