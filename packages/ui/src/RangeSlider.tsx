import React, { useCallback, useRef } from 'react';
import ResetIconButton from './ResetIconButton';
import { useUIInteractionSession } from './UIInteractionProvider';

export type RangeSliderValue = readonly [low: number, high: number];

export interface RangeSliderProps {
  label: string;
  value: RangeSliderValue;
  onValueChange: (value: [number, number]) => void;
  min?: number;
  max?: number;
  step?: number;
  minGap?: number;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  onReset?: () => void;
  displayFormatter?: (value: number) => string;
  trackBackground?: string;
  disabled?: boolean;
}

type RangeHandle = 'low' | 'high';
type RangeDragState =
  | { type: 'handle'; handle: RangeHandle }
  | {
      type: 'range';
      pointerStart: number;
      lowStart: number;
      highStart: number;
    };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const getStepPrecision = (step: number): number => {
  const value = step.toString().toLowerCase();
  if (value.includes('e-')) return Number(value.split('e-')[1]) || 0;
  return value.includes('.') ? (value.split('.')[1]?.length ?? 0) : 0;
};

export default function RangeSlider({
  label,
  value,
  onValueChange,
  min = 0,
  max = 1,
  step = 0.01,
  minGap = 0,
  onInteractionStart,
  onInteractionEnd,
  onReset,
  displayFormatter = (nextValue) => `${Math.round(nextValue * 100)}%`,
  trackBackground,
  disabled = false,
}: RangeSliderProps) {
  const dragStateRef = useRef<RangeDragState | null>(null);
  const precision = Math.min(8, getStepPrecision(step));
  const safeSpan = Math.max(Number.EPSILON, max - min);
  const low = clamp(Math.min(value[0], value[1]), min, max);
  const high = clamp(Math.max(value[0], value[1]), min, max);
  const lowPercent = ((low - min) / safeSpan) * 100;
  const highPercent = ((high - min) / safeSpan) * 100;
  const { startInteraction, endInteraction } = useUIInteractionSession({
    idPrefix: 'range-slider',
    onInteractionStart,
    onInteractionEnd,
  });

  const quantize = useCallback(
    (nextValue: number) => {
      const stepped = min + Math.round((nextValue - min) / step) * step;
      return Number(clamp(stepped, min, max).toFixed(precision));
    },
    [max, min, precision, step],
  );

  const updateHandle = useCallback(
    (handle: RangeHandle, nextValue: number) => {
      const quantized = quantize(nextValue);
      const next: [number, number] =
        handle === 'low'
          ? [Math.min(quantized, high - minGap), high]
          : [low, Math.max(quantized, low + minGap)];
      next[0] = clamp(next[0], min, max);
      next[1] = clamp(next[1], min, max);
      if (Object.is(next[0], low) && Object.is(next[1], high)) return;
      onValueChange(next);
    },
    [high, low, max, min, minGap, onValueChange, quantize],
  );

  const offsetRange = useCallback(
    (dragState: Extract<RangeDragState, { type: 'range' }>, pointerValue: number) => {
      const minOffset = min - dragState.lowStart;
      const maxOffset = max - dragState.highStart;
      const rawOffset = pointerValue - dragState.pointerStart;
      const steppedOffset = Math.round(rawOffset / step) * step;
      const offset = clamp(steppedOffset, minOffset, maxOffset);
      const next: [number, number] = [
        Number((dragState.lowStart + offset).toFixed(precision)),
        Number((dragState.highStart + offset).toFixed(precision)),
      ];
      if (Object.is(next[0], low) && Object.is(next[1], high)) return;
      onValueChange(next);
    },
    [high, low, max, min, onValueChange, precision, step],
  );

  const valueFromPointer = (event: React.PointerEvent<HTMLDivElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width > 0 ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0;
    return min + ratio * safeSpan;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    const pointerValue = valueFromPointer(event);
    const requestedRange = (event.target as HTMLElement).closest('[data-range-fill]');
    if (requestedRange) {
      dragStateRef.current = {
        type: 'range',
        pointerStart: pointerValue,
        lowStart: low,
        highStart: high,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      startInteraction();
      return;
    }
    const requestedHandle = (event.target as HTMLElement).dataset.rangeHandle as
      | RangeHandle
      | undefined;
    const handle =
      requestedHandle ??
      (Math.abs(pointerValue - low) <= Math.abs(pointerValue - high) ? 'low' : 'high');
    dragStateRef.current = { type: 'handle', handle };
    event.currentTarget.setPointerCapture(event.pointerId);
    startInteraction();
    updateHandle(handle, pointerValue);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || disabled) return;
    const pointerValue = valueFromPointer(event);
    if (dragState.type === 'range') {
      offsetRange(dragState, pointerValue);
    } else {
      updateHandle(dragState.handle, pointerValue);
    }
  };

  const finishPointerInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current) return;
    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    endInteraction();
  };

  const handleKeyDown = (handle: RangeHandle, event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const direction =
      event.key === 'ArrowLeft' || event.key === 'ArrowDown'
        ? -1
        : event.key === 'ArrowRight' || event.key === 'ArrowUp'
          ? 1
          : 0;
    if (direction === 0) return;
    event.preventDefault();
    startInteraction();
    updateHandle(handle, (handle === 'low' ? low : high) + direction * step);
    endInteraction();
  };

  return (
    <div className={`bb-range-slider space-y-1.5 ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <label className="truncate text-xs font-medium text-gray-400">{label}</label>
        <div className="flex shrink-0 items-center gap-1.5">
          <output className="min-w-16 text-right font-mono text-[10px] tabular-nums text-gray-400">
            {displayFormatter(low)} – {displayFormatter(high)}
          </output>
          {onReset ? <ResetIconButton onClick={onReset} tooltip={`Reset ${label}`} /> : null}
        </div>
      </div>
      <div
        className="relative h-7 touch-none select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerInteraction}
        onPointerCancel={finishPointerInteraction}
      >
        <div
          className="absolute inset-x-0 top-3 h-1 rounded-full bg-gray-700 shadow-inner"
          style={trackBackground ? { background: trackBackground } : undefined}
        />
        <div
          data-range-fill
          title={`Drag to offset the ${label} range`}
          className="group absolute top-2 h-5 cursor-grab touch-none active:cursor-grabbing"
          style={{ left: `${lowPercent}%`, right: `${100 - highPercent}%` }}
        >
          <div className="pointer-events-none absolute inset-x-0 top-1 h-1 rounded-full bg-white/30 shadow-[0_0_0_1px_rgb(var(--color-primary-300)/0.45)] transition group-hover:bg-white/45" />
        </div>
        {(['low', 'high'] as const).map((handle) => {
          const handleValue = handle === 'low' ? low : high;
          const percent = handle === 'low' ? lowPercent : highPercent;
          return (
            <button
              key={handle}
              type="button"
              role="slider"
              aria-label={`${label} ${handle}`}
              aria-valuemin={min}
              aria-valuemax={max}
              aria-valuenow={handleValue}
              aria-valuetext={displayFormatter(handleValue)}
              disabled={disabled}
              data-range-handle={handle}
              onKeyDown={(event) => handleKeyDown(handle, event)}
              className="absolute top-1.5 h-4 w-4 -translate-x-1/2 rounded-full border border-primary-200/70 bg-gray-100 shadow-[0_1px_4px_rgba(0,0,0,0.55)] outline-none transition hover:scale-110 focus-visible:ring-2 focus-visible:ring-primary-300/50 disabled:cursor-not-allowed"
              style={{ left: `${percent}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}
