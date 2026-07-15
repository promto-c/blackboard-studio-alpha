import React from 'react';
import { Badge, NumberInput, Popover } from '@blackboard/ui';
import {
  ExecuteButton,
  ExecuteButtonAction,
  ExecuteButtonGroup,
  ExecuteButtonMenuTrigger,
  ExecuteMenuItem,
} from '@/components';

const CLAMP = (v: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(v)));

export interface OnnxRunButtonGroupProps {
  disabled: boolean;
  runShortcutHint: string;
  currentFrame: number;
  timelineStartFrame: number;
  timelineEndFrame: number;
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
  timelineStartFrame,
  timelineEndFrame,
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
  const [rangeEnd, setRangeEnd] = React.useState(Math.min(currentFrame + 3, timelineEndFrame));

  React.useEffect(() => {
    if (disabled) {
      setIsRunMenuOpen(false);
    }
  }, [disabled]);

  // Sync range inputs with currentFrame when popover opens
  React.useEffect(() => {
    if (isRunMenuOpen) {
      setRangeStart(currentFrame);
      setRangeEnd(Math.min(currentFrame + 3, timelineEndFrame));
    }
  }, [isRunMenuOpen, currentFrame, timelineEndFrame]);

  const handleRangeStartChange = (value: number) => {
    const clamped = CLAMP(value, timelineStartFrame, Math.max(rangeEnd - 1, timelineStartFrame));
    setRangeStart(clamped);
  };

  const handleRangeEndChange = (value: number) => {
    const clamped = CLAMP(value, rangeStart + 1, timelineEndFrame);
    setRangeEnd(clamped);
  };

  return (
    <ExecuteButtonGroup disabled={disabled} className={className}>
      <ExecuteButtonAction
        onClick={() => {
          setIsRunMenuOpen(false);
          onRunFrame();
        }}
        disabled={disabled}
        title={`Run ONNX inference (${runShortcutHint})`}
      >
        Run
        {showRunFrames && storedFrameCount > 0 && (
          <Badge
            variant="neutral"
            size="sm"
            className="ml-1 border-primary-200/10 bg-primary-300/10 text-primary-200/80 font-mono font-normal"
          >
            {storedFrameCount}/{totalFrames}
          </Badge>
        )}
      </ExecuteButtonAction>
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
            <ExecuteButtonMenuTrigger
              disabled={disabled}
              title="Run frame range"
              aria-label="Run frame range"
            />
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
                  <NumberInput
                    value={rangeStart}
                    min={timelineStartFrame}
                    max={Math.max(rangeEnd - 1, timelineStartFrame)}
                    normalizeValue={Math.round}
                    onValueChange={handleRangeStartChange}
                  />
                </div>
                <span className="mt-4 text-[10px] text-gray-500">&rarr;</span>
                <div className="flex-1">
                  <label className="block text-[9px] font-medium text-gray-500 mb-0.5">To</label>
                  <NumberInput
                    value={rangeEnd}
                    min={rangeStart + 1}
                    max={timelineEndFrame}
                    normalizeValue={Math.round}
                    onValueChange={handleRangeEndChange}
                  />
                </div>
              </div>
              <ExecuteButton
                fullWidth
                onClick={() => {
                  closePopover();
                  onRunFrameRange(rangeStart, rangeEnd);
                }}
                disabled={disabled || rangeStart >= rangeEnd}
                className="min-h-9"
              >
                Run range
              </ExecuteButton>
              <div className="border-t border-white/10" />
              <ExecuteMenuItem
                onClick={() => {
                  closePopover();
                  onRunAllFrames();
                }}
                label="Run all frames"
                meta={`${totalFrames} frames`}
              />
            </div>
          )}
        </Popover>
      )}
    </ExecuteButtonGroup>
  );
}
