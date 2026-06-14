import React from 'react';
import { Popover } from '@blackboard/ui';
import * as Icons from '@blackboard/icons';

const CLAMP = (v: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(v)));

export interface OnnxRunButtonGroupProps {
  disabled: boolean;
  runShortcutHint: string;
  currentFrame: number;
  totalFrames: number;
  storedFrameCount: number;
  onRunFrame: () => void;
  onRunFrameRange: (startFrame: number, endFrame: number) => void;
  onRunAllFrames: () => void;
  showRunFrames?: boolean;
  className?: string;
}

export function OnnxRunButtonGroup({
  disabled,
  runShortcutHint,
  currentFrame,
  totalFrames,
  storedFrameCount,
  onRunFrame,
  onRunFrameRange,
  onRunAllFrames,
  showRunFrames = true,
  className,
}: OnnxRunButtonGroupProps) {
  const [isRunMenuOpen, setIsRunMenuOpen] = React.useState(false);
  const [rangeStart, setRangeStart] = React.useState(currentFrame);
  const [rangeEnd, setRangeEnd] = React.useState(Math.min(currentFrame + 3, totalFrames - 1));

  React.useEffect(() => {
    if (disabled) {
      setIsRunMenuOpen(false);
    }
  }, [disabled]);

  // Sync range inputs with currentFrame when popover opens
  React.useEffect(() => {
    if (isRunMenuOpen) {
      setRangeStart(currentFrame);
      setRangeEnd(Math.min(currentFrame + 3, totalFrames - 1));
    }
  }, [isRunMenuOpen, currentFrame, totalFrames]);

  const handleRangeStartChange = (value: number) => {
    const clamped = CLAMP(value, 0, Math.max(rangeEnd - 1, 0));
    setRangeStart(clamped);
  };

  const handleRangeEndChange = (value: number) => {
    const clamped = CLAMP(value, rangeStart + 1, totalFrames - 1);
    setRangeEnd(clamped);
  };

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
          onRunFrame();
        }}
        disabled={disabled}
        title={`Run ONNX inference (${runShortcutHint})`}
        className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 px-2 py-1 text-[10px] font-medium transition hover:bg-primary-300/15 disabled:cursor-not-allowed disabled:bg-gray-900/70 disabled:text-gray-500"
      >
        <Icons.Play className="h-3.5 w-3.5" />
        Run
        {showRunFrames && storedFrameCount > 0 && (
          <span className="ml-1 rounded-full bg-primary-500/20 px-1.5 py-0.5 font-mono text-[9px] text-primary-200">
            {storedFrameCount}/{totalFrames}
          </span>
        )}
      </button>
      {showRunFrames && (
        <Popover
          isOpen={disabled ? false : isRunMenuOpen}
          onOpenChange={(open) => {
            if (disabled) return;
            setIsRunMenuOpen(open);
          }}
          align="end"
          widthClass="w-52"
          trigger={
            <button
              type="button"
              disabled={disabled}
              className="relative inline-flex h-full items-center justify-center px-1.5 transition hover:bg-primary-300/15 before:pointer-events-none before:absolute before:left-0 before:top-1/2 before:h-3.5 before:w-px before:-translate-y-1/2 before:bg-primary-300/20 disabled:cursor-not-allowed disabled:bg-gray-900/70 disabled:text-gray-500 disabled:before:bg-gray-700"
              title="Run frame range"
              aria-label="Run frame range"
            >
              <Icons.ChevronDown className="h-3.5 w-3.5" />
            </button>
          }
        >
          {(closePopover) => (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                  Frame Range
                </p>
                {storedFrameCount > 0 && (
                  <span className="font-mono text-[10px] text-gray-500">
                    {storedFrameCount}/{totalFrames}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="block text-[9px] font-medium text-gray-500 mb-0.5">From</label>
                  <input
                    type="number"
                    value={rangeStart}
                    min={0}
                    max={Math.max(rangeEnd - 1, 0)}
                    onChange={(e) => handleRangeStartChange(Number(e.target.value))}
                    className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] font-mono text-gray-100 transition [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-primary-400/40 focus:outline-none"
                  />
                </div>
                <span className="mt-4 text-[10px] text-gray-500">&rarr;</span>
                <div className="flex-1">
                  <label className="block text-[9px] font-medium text-gray-500 mb-0.5">To</label>
                  <input
                    type="number"
                    value={rangeEnd}
                    min={rangeStart + 1}
                    max={totalFrames - 1}
                    onChange={(e) => handleRangeEndChange(Number(e.target.value))}
                    className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] font-mono text-gray-100 transition [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-primary-400/40 focus:outline-none"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  closePopover();
                  onRunFrameRange(rangeStart, rangeEnd);
                }}
                disabled={disabled || rangeStart >= rangeEnd}
                className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary-500/15 px-2.5 py-2 text-xs font-medium text-primary-100 transition hover:bg-primary-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icons.Play className="h-3 w-3" />
                Run Range
              </button>
              <div className="border-t border-white/10" />
              <button
                type="button"
                onClick={() => {
                  closePopover();
                  onRunAllFrames();
                }}
                className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs text-gray-300 transition hover:bg-white/[0.06] hover:text-white"
              >
                <span>All Frames</span>
                <span className="font-mono text-[11px] text-gray-500">{totalFrames} frames</span>
              </button>
            </div>
          )}
        </Popover>
      )}
    </div>
  );
}
