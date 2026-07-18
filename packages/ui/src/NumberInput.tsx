import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useUIInteractionSession } from './UIInteractionProvider';
import { DEFAULT_CONTROL_INPUT_CLASS } from './controlInputStyles';
import {
  extendNumericPrecisionAtCaret,
  formatValueForNumericPlace,
  getCaretPositionForNumericPlace,
  getNumericCaretStep,
} from './numberInputStepping';

export type NumberInputChangeSource = 'keyboard' | 'wheel' | 'drag' | 'commit';
export interface NumberInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'defaultValue' | 'onChange'
> {
  value: number;
  onValueChange: (value: number, source: NumberInputChangeSource) => void;
  formatValue?: (value: number) => string;
  normalizeValue?: (value: number) => number;
  scrubStep?: number;
  fineScrubStep?: number;
  coarseScrubStep?: number;
  /** Read-only unit or suffix rendered inside the trailing edge of the field. */
  suffix?: React.ReactNode;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}

const DRAG_THRESHOLD_PX = 4;

const DEFAULT_NUMBER_INPUT_CLASS = `${DEFAULT_CONTROL_INPUT_CLASS} font-mono tabular-nums`;

type PendingInputSelection =
  | { kind: 'caret'; position: number }
  | {
      affinity: 'after' | 'before';
      kind: 'place';
      place: number;
      selection: {
        direction: 'backward' | 'forward' | 'none';
        end: number;
        selectAll: boolean;
        start: number;
      } | null;
    }
  | { end: number; kind: 'range'; selectAll: boolean; start: number };

const finiteAttribute = (value: string | number | undefined): number | undefined => {
  if (value === undefined || value === '') return undefined;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : undefined;
};

const decimalPlaces = (value: number): number => {
  const text = String(value).toLowerCase();
  if (text.includes('e-')) return Number(text.split('e-')[1]) || 0;
  return text.includes('.') ? text.length - text.indexOf('.') - 1 : 0;
};

const clamp = (value: number, min?: number, max?: number): number =>
  Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, value));

const resolveStep = (step: string | number | undefined): number => {
  if (step === 'any') return 1;
  const numericStep = finiteAttribute(step);
  return numericStep && numericStep > 0 ? numericStep : 1;
};

const stepValue = (
  currentValue: number,
  direction: 1 | -1,
  step: number,
  min?: number,
  max?: number,
): number => {
  const precision = Math.min(12, Math.max(decimalPlaces(currentValue), decimalPlaces(step)));
  return clamp(Number((currentValue + direction * step).toFixed(precision)), min, max);
};

const defaultFormatValue = (value: number): string =>
  Number.isFinite(value) ? String(value) : '0';

const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  (
    {
      value,
      onValueChange,
      formatValue = defaultFormatValue,
      normalizeValue = (nextValue) => nextValue,
      scrubStep: scrubStepProp,
      fineScrubStep: fineScrubStepProp,
      coarseScrubStep: coarseScrubStepProp,
      suffix,
      onInteractionStart,
      onInteractionEnd,
      min: minProp,
      max: maxProp,
      step: stepProp,
      disabled,
      readOnly,
      onBlur,
      onFocus,
      onKeyDown,
      onWheel,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture,
      className,
      inputMode = 'decimal',
      ...props
    },
    forwardedRef,
  ) => {
    const [draft, setDraft] = useState(() => formatValue(value));
    const [isEditing, setIsEditing] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const isEditingRef = useRef(false);
    const skipBlurCommitRef = useRef(false);
    const pendingInputSelectionRef = useRef<PendingInputSelection | null>(null);
    const dragRef = useRef<{
      pointerId: number;
      startX: number;
      startValue: number;
      dragging: boolean;
    } | null>(null);
    const previousBodyStylesRef = useRef<{ cursor: string; userSelect: string } | null>(null);
    const { startInteraction, endInteraction } = useUIInteractionSession({
      idPrefix: 'number-input',
      onInteractionStart,
      onInteractionEnd,
    });
    const min = finiteAttribute(minProp);
    const max = finiteAttribute(maxProp);
    const step = resolveStep(stepProp);
    const scrubStep = finiteAttribute(scrubStepProp) ?? step;
    const fineScrubStep = finiteAttribute(fineScrubStepProp) ?? scrubStep * 0.1;
    const coarseScrubStep = finiteAttribute(coarseScrubStepProp) ?? scrubStep * 10;
    const hasSuffix = suffix !== undefined && suffix !== null;

    const setRef = (element: HTMLInputElement | null) => {
      inputRef.current = element;
      if (typeof forwardedRef === 'function') forwardedRef(element);
      else if (forwardedRef) forwardedRef.current = element;
    };

    useEffect(() => {
      if (!isEditingRef.current) setDraft(formatValue(value));
    }, [formatValue, value]);

    useLayoutEffect(() => {
      const pendingSelection = pendingInputSelectionRef.current;
      const input = inputRef.current;
      pendingInputSelectionRef.current = null;
      if (!pendingSelection || !input || document.activeElement !== input) return;

      if (pendingSelection.kind === 'caret') {
        const position = Math.min(pendingSelection.position, input.value.length);
        input.setSelectionRange(position, position);
        return;
      }

      if (pendingSelection.kind === 'range') {
        const start = Math.min(pendingSelection.start, input.value.length);
        const end = pendingSelection.selectAll
          ? input.value.length
          : Math.min(pendingSelection.end, input.value.length);
        input.setSelectionRange(start, Math.max(start, end));
        return;
      }

      const caretPosition = getCaretPositionForNumericPlace(input.value, pendingSelection.place);
      if (caretPosition !== null) {
        if (pendingSelection.selection) {
          const selectionStart = Math.min(pendingSelection.selection.start, input.value.length);
          const selectionEnd = pendingSelection.selection.selectAll
            ? input.value.length
            : Math.min(pendingSelection.selection.end, input.value.length);
          input.setSelectionRange(
            selectionStart,
            Math.max(selectionStart, selectionEnd),
            pendingSelection.selection.direction,
          );
        } else {
          const offset = pendingSelection.affinity === 'after' ? 1 : 0;
          input.setSelectionRange(caretPosition + offset, caretPosition + offset);
        }
      }
    });

    const restoreBodyInteractionStyles = () => {
      const previousStyles = previousBodyStylesRef.current;
      if (!previousStyles) return;
      document.body.style.cursor = previousStyles.cursor;
      document.body.style.userSelect = previousStyles.userSelect;
      previousBodyStylesRef.current = null;
    };

    const stopDragging = () => {
      dragRef.current = null;
      setIsDragging(false);
      restoreBodyInteractionStyles();
    };

    useEffect(
      () => () => {
        restoreBodyInteractionStyles();
      },
      [],
    );

    const applyValue = (
      nextValue: number,
      source: NumberInputChangeSource,
      stepSelection: PendingInputSelection | null = null,
    ) => {
      if (!Number.isFinite(nextValue)) return;
      const normalizedValue = clamp(normalizeValue(nextValue), min, max);
      if (!Number.isFinite(normalizedValue)) return;
      const formattedValue =
        stepSelection?.kind === 'place' && formatValue === defaultFormatValue
          ? formatValueForNumericPlace(normalizedValue, stepSelection.place, draft)
          : formatValue(normalizedValue);
      if (stepSelection && formattedValue !== draft) {
        pendingInputSelectionRef.current = stepSelection;
      }
      setDraft(formattedValue);
      if (!Object.is(normalizedValue, value)) onValueChange(normalizedValue, source);
    };

    const commitDraft = () => {
      const parsedValue = Number(draft.trim());
      if (draft.trim() && Number.isFinite(parsedValue)) {
        applyValue(parsedValue, 'commit');
      } else {
        setDraft(formatValue(value));
      }
    };

    const applyStep = (direction: 1 | -1, source: 'keyboard' | 'wheel') => {
      const draftValue = Number(draft);
      const currentValue = Number.isFinite(draftValue) ? draftValue : value;
      const input = inputRef.current;
      const caretStep = input
        ? getNumericCaretStep(draft, input.selectionStart, input.selectionEnd)
        : null;
      const activeStep = caretStep?.step ?? step;
      const selectionStart = input?.selectionStart ?? null;
      const selectionEnd = input?.selectionEnd ?? null;
      const stepSelection: PendingInputSelection | null = caretStep
        ? {
            affinity: caretStep.affinity,
            kind: 'place',
            place: caretStep.place,
            selection:
              selectionStart !== null && selectionEnd !== null && selectionStart !== selectionEnd
                ? {
                    direction: input?.selectionDirection ?? 'none',
                    start: selectionStart,
                    end: selectionEnd,
                    selectAll: selectionStart === 0 && selectionEnd === draft.length,
                  }
                : null,
          }
        : selectionStart !== null && selectionEnd !== null
          ? {
              kind: 'range',
              start: selectionStart,
              end: selectionEnd,
              selectAll: selectionStart === 0 && selectionEnd === draft.length,
            }
          : null;
      applyValue(stepValue(currentValue, direction, activeStep, min, max), source, stepSelection);
    };

    const extendPrecision = (): boolean => {
      const input = inputRef.current;
      const extension = input
        ? extendNumericPrecisionAtCaret(draft, input.selectionStart, input.selectionEnd)
        : null;
      if (!extension) return false;

      pendingInputSelectionRef.current = { kind: 'caret', position: extension.caret };
      setDraft(extension.text);
      return true;
    };

    const beginEditing = () => {
      if (disabled || readOnly) return;
      isEditingRef.current = true;
      setIsEditing(true);
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    };

    useEffect(() => {
      const input = inputRef.current;
      if (!input) return;

      const handleNativeWheel = (event: WheelEvent) => {
        if (disabled || readOnly || document.activeElement !== input || event.deltaY === 0) {
          return;
        }
        event.preventDefault();
        applyStep(event.deltaY < 0 ? 1 : -1, 'wheel');
      };

      input.addEventListener('wheel', handleNativeWheel, { passive: false });
      return () => input.removeEventListener('wheel', handleNativeWheel);
    });

    const input = (
      <input
        {...props}
        ref={setRef}
        type="text"
        role="spinbutton"
        inputMode={inputMode}
        value={draft}
        min={minProp}
        max={maxProp}
        step={stepProp}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number.isFinite(value) ? value : undefined}
        disabled={disabled}
        readOnly={readOnly}
        data-editing={isEditing ? 'true' : 'false'}
        data-dragging={isDragging ? 'true' : 'false'}
        className={[
          DEFAULT_NUMBER_INPUT_CLASS,
          className,
          hasSuffix ? '!pr-10' : '',
          'transition-[background-color,border-color,box-shadow] duration-100',
          disabled || readOnly
            ? '!cursor-not-allowed'
            : isEditing
              ? '!cursor-text'
              : 'touch-none !cursor-ew-resize select-none',
          isDragging
            ? 'bg-primary-400/[0.08] shadow-[inset_0_0_0_1px_rgb(var(--color-primary-300)/0.45),0_0_0_3px_rgb(var(--color-primary-400)/0.08)]'
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onFocus={(event) => {
          isEditingRef.current = true;
          setIsEditing(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          if (skipBlurCommitRef.current) skipBlurCommitRef.current = false;
          else commitDraft();
          isEditingRef.current = false;
          setIsEditing(false);
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || disabled || readOnly) return;
          if (event.key === 'ArrowRight' && extendPrecision()) {
            event.preventDefault();
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            applyStep(event.key === 'ArrowUp' ? 1 : -1, 'keyboard');
          } else if (event.key === 'Enter') {
            event.preventDefault();
            commitDraft();
            skipBlurCommitRef.current = true;
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setDraft(formatValue(value));
            skipBlurCommitRef.current = true;
            event.currentTarget.blur();
          }
        }}
        onWheel={onWheel}
        onPointerDown={(event) => {
          onPointerDown?.(event);
          if (event.defaultPrevented || disabled || readOnly || isEditing || event.button !== 0) {
            return;
          }
          dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startValue: value,
            dragging: false,
          };
          event.currentTarget.setPointerCapture?.(event.pointerId);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          onPointerMove?.(event);
          if (event.defaultPrevented) return;
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const deltaX = event.clientX - drag.startX;
          if (!drag.dragging && Math.abs(deltaX) >= DRAG_THRESHOLD_PX) {
            drag.dragging = true;
            setIsDragging(true);
            startInteraction();
            previousBodyStylesRef.current = {
              cursor: document.body.style.cursor,
              userSelect: document.body.style.userSelect,
            };
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
          }
          if (!drag.dragging) return;
          const activeStep = event.shiftKey
            ? fineScrubStep
            : event.altKey || event.ctrlKey || event.metaKey
              ? coarseScrubStep
              : scrubStep;
          applyValue(drag.startValue + deltaX * activeStep, 'drag');
        }}
        onPointerUp={(event) => {
          onPointerUp?.(event);
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const wasDragging = drag.dragging;
          const hasPointerCapture = event.currentTarget.hasPointerCapture?.(event.pointerId);
          stopDragging();
          if (hasPointerCapture) {
            event.currentTarget.releasePointerCapture?.(event.pointerId);
          }
          if (wasDragging) endInteraction();
          if (!wasDragging) beginEditing();
        }}
        onPointerCancel={(event) => {
          onPointerCancel?.(event);
          if (dragRef.current?.pointerId === event.pointerId) {
            const wasDragging = dragRef.current.dragging;
            stopDragging();
            if (wasDragging) endInteraction();
          }
        }}
        onLostPointerCapture={(event) => {
          onLostPointerCapture?.(event);
          if (dragRef.current?.pointerId === event.pointerId) {
            const wasDragging = dragRef.current.dragging;
            stopDragging();
            if (wasDragging) endInteraction();
          }
        }}
      />
    );

    if (!hasSuffix) return input;

    return (
      <div className="relative w-full min-w-0">
        {input}
        <span
          aria-hidden="true"
          data-number-input-suffix
          className={[
            'pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[10px] font-medium text-gray-500',
            disabled ? 'opacity-55' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {suffix}
        </span>
      </div>
    );
  },
);

NumberInput.displayName = 'NumberInput';

export default NumberInput;
