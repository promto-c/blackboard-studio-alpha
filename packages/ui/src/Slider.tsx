import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import KeyframeButton from './KeyframeButton';
import ResetIconButton from './ResetIconButton';

export interface SliderProps {
  label: string;
  description?: React.ReactNode;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  onReset?: () => void;
  displayFormatter?: (value: number) => string;
  isKeyframed?: boolean;
  onToggleKeyframe?: () => void;
  valuePrefix?: React.ReactNode;
  headerActions?: React.ReactNode;
  resetTooltip?: string;
  /**
   * When set, the slider extends by one step beyond max.
   * At that extended position the value display shows this label
   * (e.g. "∞") to indicate an overflow/unlimited state.
   */
  overflowLabel?: string;
}

const getStepPrecision = (step: number): number => {
  if (!Number.isFinite(step)) {
    return 0;
  }

  const stepString = step.toString().toLowerCase();
  if (stepString.includes('e-')) {
    return parseInt(stepString.split('e-')[1] ?? '0', 10) || 0;
  }

  return stepString.includes('.') ? (stepString.split('.')[1]?.length ?? 0) : 0;
};

const formatEditableValue = (value: number, step: number): string => {
  if (!Number.isFinite(value)) {
    return '';
  }

  const precision = Math.min(8, Math.max(getStepPrecision(step), 0));
  return precision === 0 ? String(Math.round(value)) : Number(value.toFixed(precision)).toString();
};

const parseEditableValue = (draft: string): number | null => {
  const normalized = draft.trim().replace(/,/g, '').replace(/−/g, '-').replace(/^±/, '');
  if (!normalized) {
    return null;
  }

  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const clampValue = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function Slider({
  label,
  description,
  value,
  min = 0,
  max = 200,
  step = 1,
  onChange,
  onInteractionStart,
  onInteractionEnd,
  onReset,
  displayFormatter = (v) => v.toString(),
  isKeyframed,
  onToggleKeyframe,
  valuePrefix,
  headerActions,
  resetTooltip,
  overflowLabel,
}: SliderProps) {
  const cleanupRef = useRef<(() => void) | null>(null);
  const skipNextManualCommitRef = useRef(false);
  const descriptionId = useId();
  const isOverflow = overflowLabel !== undefined && value > max;
  const effectiveMax = overflowLabel !== undefined ? max + step : max;
  const [isEditingValue, setIsEditingValue] = useState(false);
  const [draftValue, setDraftValue] = useState(() =>
    formatEditableValue(isOverflow ? max : value, step),
  );
  const fillPercent = Math.min(100, ((value - min) / (effectiveMax - min)) * 100);
  const hasDescription = description !== undefined && description !== null;
  const descriptionTitle = typeof description === 'string' ? description : undefined;

  useEffect(() => {
    if (!isEditingValue) {
      setDraftValue(formatEditableValue(isOverflow ? max : value, step));
    }
  }, [isEditingValue, isOverflow, max, step, value]);

  const releaseInteractionListeners = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, []);

  useEffect(() => releaseInteractionListeners, [releaseInteractionListeners]);

  const handleInteractionStart = useCallback(() => {
    onInteractionStart?.();
    releaseInteractionListeners();

    if (typeof window === 'undefined') return;

    const handleInteractionEnd = () => {
      releaseInteractionListeners();
      onInteractionEnd?.();
    };

    window.addEventListener('pointerup', handleInteractionEnd, true);
    window.addEventListener('pointercancel', handleInteractionEnd, true);
    cleanupRef.current = () => {
      window.removeEventListener('pointerup', handleInteractionEnd, true);
      window.removeEventListener('pointercancel', handleInteractionEnd, true);
    };
  }, [onInteractionEnd, onInteractionStart, releaseInteractionListeners]);

  const handleBlur = useCallback(() => {
    if (!cleanupRef.current) return;
    releaseInteractionListeners();
    onInteractionEnd?.();
  }, [onInteractionEnd, releaseInteractionListeners]);

  const commitManualValue = useCallback(() => {
    const parsed = parseEditableValue(draftValue);
    if (parsed === null) {
      setDraftValue(formatEditableValue(value, step));
      return;
    }

    const nextValue = clampValue(parsed, min, max);
    setDraftValue(formatEditableValue(nextValue, step));
    if (Object.is(nextValue, value)) {
      return;
    }

    onInteractionStart?.();
    onChange(nextValue);
    onInteractionEnd?.();
  }, [draftValue, max, min, onChange, onInteractionEnd, onInteractionStart, step, value]);

  const handleValueFocus = useCallback(
    (event: React.FocusEvent<HTMLInputElement>) => {
      if (isOverflow) return;
      skipNextManualCommitRef.current = false;
      setIsEditingValue(true);
      setDraftValue(formatEditableValue(value, step));
      event.currentTarget.select();
    },
    [isOverflow, step, value],
  );

  const handleValueBlur = useCallback(() => {
    if (isOverflow) {
      setIsEditingValue(false);
      return;
    }
    if (skipNextManualCommitRef.current) {
      skipNextManualCommitRef.current = false;
      setDraftValue(formatEditableValue(value, step));
      setIsEditingValue(false);
      return;
    }

    commitManualValue();
    setIsEditingValue(false);
  }, [commitManualValue, isOverflow, step, value]);

  const handleValueKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      skipNextManualCommitRef.current = true;
      event.currentTarget.blur();
    }
  }, []);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {onToggleKeyframe && (
            <KeyframeButton
              isKeyframed={isKeyframed || false}
              onClick={onToggleKeyframe}
              title={isKeyframed ? 'Remove keyframe at this frame' : 'Add keyframe at this frame'}
            />
          )}
          <label className="max-w-[105%] shrink-0 truncate text-xs font-medium text-gray-400">
            {label}
          </label>
          {hasDescription && (
            <span
              id={descriptionId}
              title={descriptionTitle}
              className="min-w-0 flex-1 truncate text-[11px] leading-4 text-gray-500"
            >
              {description}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {valuePrefix}
          <input
            aria-label={`${label} value`}
            aria-describedby={hasDescription ? descriptionId : undefined}
            type="text"
            inputMode={isOverflow ? undefined : 'decimal'}
            readOnly={isOverflow}
            tabIndex={isOverflow ? -1 : 0}
            value={
              isOverflow
                ? (overflowLabel ?? '∞')
                : isEditingValue
                  ? draftValue
                  : displayFormatter(value)
            }
            onFocus={handleValueFocus}
            onBlur={handleValueBlur}
            onChange={(event) => setDraftValue(event.currentTarget.value)}
            onKeyDown={handleValueKeyDown}
            className={`h-5 w-12 rounded border border-transparent bg-transparent p-0 text-right font-mono text-xs outline-none transition ${
              isOverflow
                ? 'cursor-default text-primary-300'
                : 'text-gray-300 hover:border-white/10 hover:bg-white/[0.04] hover:text-white focus:border-primary-400 focus:bg-gray-950 focus:text-white'
            }`}
          />
          {onReset ? (
            <ResetIconButton
              onClick={onReset}
              tooltip={resetTooltip ?? `Reset ${label} to its default value`}
            />
          ) : null}
          {headerActions}
        </div>
      </div>
      <div
        className={`glass-slider-container ${isOverflow ? 'glass-slider-overflow' : ''}`}
        style={
          {
            '--slider-fill-percent': `${fillPercent}%`,
          } as React.CSSProperties
        }
      >
        <input
          type="range"
          min={min}
          max={effectiveMax}
          step={step}
          value={value}
          aria-label={label}
          aria-describedby={hasDescription ? descriptionId : undefined}
          onPointerDown={handleInteractionStart}
          onBlur={handleBlur}
          onInput={(e) => onChange(parseFloat(e.currentTarget.value))}
          className="glass-slider"
        />
      </div>
    </div>
  );
}

export default Slider;
