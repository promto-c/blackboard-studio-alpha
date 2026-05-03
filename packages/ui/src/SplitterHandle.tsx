import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Icons from '@blackboard/icons';

type SplitterAxis = 'x' | 'y';
type SplitterValueType = 'px' | 'percent';
const RAIL_PROXIMITY_PX = 28;
const RAIL_END_MARGIN_PX = 16;

export interface SplitterHandleProps {
  axis: SplitterAxis;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  defaultValue?: number;
  measurementRef?: React.RefObject<HTMLElement | null>;
  valueType?: SplitterValueType;
  direction?: 1 | -1;
  step?: number;
  shiftStep?: number;
  formatValue?: (value: number) => string;
  title?: string;
  className?: string;
  hideHandleBeforeRatio?: number;
  hideHandleAfterRatio?: number;
}

const clampValue = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const mixChannel = (from: number, to: number, amount: number) =>
  Math.round(from + (to - from) * amount);
const getEdgeVisibility = (
  interactionRatio: number,
  hideHandleBeforeRatio: number,
  hideHandleAfterRatio: number,
) => {
  const beforeVisibility =
    hideHandleBeforeRatio <= 0 ? 1 : clampValue(interactionRatio / hideHandleBeforeRatio, 0, 1);
  const afterVisibility =
    hideHandleAfterRatio >= 1
      ? 1
      : clampValue((1 - interactionRatio) / (1 - hideHandleAfterRatio), 0, 1);
  return Math.min(beforeVisibility, afterVisibility);
};

const SplitterHandle: React.FC<SplitterHandleProps> = ({
  axis,
  label,
  value,
  min,
  max,
  onChange,
  defaultValue,
  measurementRef,
  valueType = 'px',
  direction = 1,
  step = valueType === 'percent' ? 2 : 8,
  shiftStep = valueType === 'percent' ? 6 : 24,
  formatValue,
  title,
  className = '',
  hideHandleBeforeRatio = 0,
  hideHandleAfterRatio = 1,
}) => {
  const handleRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [proximityStrength, setProximityStrength] = useState(0);

  const resolvedTitle = title ?? `Resize ${label.toLowerCase()}`;
  const orientation = axis === 'x' ? 'vertical' : 'horizontal';
  const isVerticalRail = axis === 'x';
  const [interactionRatio, setInteractionRatio] = useState(0.5);
  const interactionStrength = isDragging
    ? 1
    : Math.max(isHovered || isFocused ? 1 : 0, proximityStrength);
  const handleVisibility = getEdgeVisibility(
    interactionRatio,
    hideHandleBeforeRatio,
    hideHandleAfterRatio,
  );
  const isVisible = interactionStrength > 0 && handleVisibility > 0;
  const showTooltip = (isHovered || isFocused || isDragging) && handleVisibility > 0.05;

  const displayValue = useMemo(() => {
    if (formatValue) return formatValue(value);
    const roundedValue = Math.round(value);
    return valueType === 'percent' ? `${roundedValue}%` : `${roundedValue}px`;
  }, [formatValue, value, valueType]);

  const releasePointerListeners = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, []);

  useEffect(() => releasePointerListeners, [releasePointerListeners]);

  const getMeasurementSize = useCallback(() => {
    const measurementElement = measurementRef?.current ?? handleRef.current?.parentElement;
    if (!measurementElement) return 0;
    const rect = measurementElement.getBoundingClientRect();
    return axis === 'x' ? rect.width : rect.height;
  }, [axis, measurementRef]);

  const updateInteractionPosition = useCallback(
    (clientX: number, clientY: number) => {
      const railRect = handleRef.current?.getBoundingClientRect();
      if (!railRect) return;

      const railLength = isVerticalRail ? railRect.height : railRect.width;
      if (railLength <= 0) return;

      const offset = isVerticalRail ? clientY - railRect.top : clientX - railRect.left;
      setInteractionRatio(clampValue(offset / railLength, 0, 1));
    },
    [isVerticalRail],
  );

  const getProximityStrength = useCallback(
    (clientX: number, clientY: number) => {
      const railRect = handleRef.current?.getBoundingClientRect();
      if (!railRect) return 0;

      const alongValue = isVerticalRail ? clientY : clientX;
      const alongStart = isVerticalRail ? railRect.top : railRect.left;
      const alongEnd = isVerticalRail ? railRect.bottom : railRect.right;

      if (
        alongValue < alongStart - RAIL_END_MARGIN_PX ||
        alongValue > alongEnd + RAIL_END_MARGIN_PX
      ) {
        return 0;
      }

      const railCenter = isVerticalRail
        ? railRect.left + railRect.width / 2
        : railRect.top + railRect.height / 2;
      const crossValue = isVerticalRail ? clientX : clientY;
      return clampValue(1 - Math.abs(crossValue - railCenter) / RAIL_PROXIMITY_PX, 0, 1);
    },
    [isVerticalRail],
  );

  const syncPointerProximity = useCallback(
    (clientX: number, clientY: number) => {
      const nextStrength = getProximityStrength(clientX, clientY);
      setProximityStrength(nextStrength);
      if (nextStrength > 0) {
        updateInteractionPosition(clientX, clientY);
      }
    },
    [getProximityStrength, updateInteractionPosition],
  );

  const commitValue = useCallback(
    (nextValue: number) => {
      onChange(clampValue(nextValue, min, max));
    },
    [max, min, onChange],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;

      event.preventDefault();
      updateInteractionPosition(event.clientX, event.clientY);
      setProximityStrength(1);

      const startValue = value;
      const startX = event.clientX;
      const startY = event.clientY;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      setIsDragging(true);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        updateInteractionPosition(moveEvent.clientX, moveEvent.clientY);
        const delta = axis === 'x' ? moveEvent.clientX - startX : moveEvent.clientY - startY;
        const normalizedDelta =
          valueType === 'percent'
            ? ((direction * delta) / Math.max(getMeasurementSize(), 1)) * 100
            : direction * delta;

        commitValue(startValue + normalizedDelta);
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerUp);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        setIsDragging(false);
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        cleanup();
        syncPointerProximity(upEvent.clientX, upEvent.clientY);
        cleanupRef.current = null;
      };

      cleanupRef.current = cleanup;

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerUp);
    },
    [
      axis,
      commitValue,
      direction,
      getMeasurementSize,
      syncPointerProximity,
      updateInteractionPosition,
      value,
      valueType,
    ],
  );

  useEffect(() => {
    const handleWindowPointerMove = (event: PointerEvent) => {
      if (isDragging) return;
      if (event.pointerType && event.pointerType !== 'mouse') {
        setProximityStrength(0);
        return;
      }

      syncPointerProximity(event.clientX, event.clientY);
    };

    const handleWindowMouseLeave = () => {
      if (!isDragging) {
        setProximityStrength(0);
      }
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    document.documentElement.addEventListener('mouseleave', handleWindowMouseLeave);

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      document.documentElement.removeEventListener('mouseleave', handleWindowMouseLeave);
    };
  }, [isDragging, syncPointerProximity]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const deltaStep = event.shiftKey ? shiftStep : step;
      const positiveKeys = axis === 'x' ? ['ArrowRight'] : ['ArrowDown'];
      const negativeKeys = axis === 'x' ? ['ArrowLeft'] : ['ArrowUp'];

      if (positiveKeys.includes(event.key)) {
        event.preventDefault();
        commitValue(value + direction * deltaStep);
        return;
      }

      if (negativeKeys.includes(event.key)) {
        event.preventDefault();
        commitValue(value - direction * deltaStep);
        return;
      }

      if (event.key === 'Home') {
        event.preventDefault();
        commitValue(min);
        return;
      }

      if (event.key === 'End') {
        event.preventDefault();
        commitValue(max);
        return;
      }

      if (defaultValue !== undefined && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        commitValue(defaultValue);
      }
    },
    [axis, commitValue, defaultValue, direction, max, min, shiftStep, step, value],
  );

  const handleDoubleClick = useCallback(() => {
    if (defaultValue === undefined) return;
    commitValue(defaultValue);
  }, [commitValue, defaultValue]);

  const interactionPositionStyle: React.CSSProperties = isVerticalRail
    ? { top: `${interactionRatio * 100}%` }
    : { left: `${interactionRatio * 100}%` };
  const interactionPercent = interactionRatio * 100;
  const lineGlowHalfSpan = 50 + interactionStrength * 22;
  const lineCoreHalfSpan = 0.75 + interactionStrength * 4.25;
  const lineFadeStart = Math.max(interactionPercent - lineGlowHalfSpan, 0);
  const lineCoreStart = Math.max(interactionPercent - lineCoreHalfSpan, 0);
  const lineCoreEnd = Math.min(interactionPercent + lineCoreHalfSpan, 100);
  const lineFadeEnd = Math.min(interactionPercent + lineGlowHalfSpan, 100);
  const lineAccentColor = `rgb(${mixChannel(255, 45, interactionStrength)} ${mixChannel(
    255,
    212,
    interactionStrength,
  )} ${mixChannel(255, 191, interactionStrength)} / ${0.08 + interactionStrength * 0.52})`;
  const lineShoulderColor = `rgb(${mixChannel(255, 45, interactionStrength)} ${mixChannel(
    255,
    212,
    interactionStrength,
  )} ${mixChannel(255, 191, interactionStrength)} / ${0.03 + interactionStrength * 0.22})`;
  const handleMorphScale = 0.72 + handleVisibility * 0.28;
  const lineStyle: React.CSSProperties = {
    opacity: (interactionStrength > 0 ? 0.18 + interactionStrength * 0.82 : 0) * handleVisibility,
    backgroundImage: isVerticalRail
      ? `linear-gradient(to bottom, transparent 0%, transparent ${lineFadeStart}%, ${lineShoulderColor} ${lineCoreStart}%, ${lineAccentColor} ${interactionPercent}%, ${lineShoulderColor} ${lineCoreEnd}%, transparent ${lineFadeEnd}%, transparent 100%)`
      : `linear-gradient(to right, transparent 0%, transparent ${lineFadeStart}%, ${lineShoulderColor} ${lineCoreStart}%, ${lineAccentColor} ${interactionPercent}%, ${lineShoulderColor} ${lineCoreEnd}%, transparent ${lineFadeEnd}%, transparent 100%)`,
  };
  const handleStyle: React.CSSProperties = {
    ...interactionPositionStyle,
    opacity:
      (isDragging ? 1 : interactionStrength > 0 ? 0.22 + interactionStrength * 0.78 : 0) *
      handleVisibility,
  };

  return (
    <div
      className={`relative z-20 shrink-0 overflow-visible pointer-events-none ${
        isVerticalRail ? 'h-full w-0' : 'h-0 w-full'
      } ${className}`}
    >
      <div
        ref={handleRef}
        role="separator"
        tabIndex={0}
        aria-label={resolvedTitle}
        aria-orientation={orientation}
        aria-valuemin={Math.round(min)}
        aria-valuemax={Math.round(max)}
        aria-valuenow={Math.round(value)}
        aria-valuetext={displayValue}
        title={`${resolvedTitle}${defaultValue !== undefined ? ' (double-click to reset)' : ''}`}
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        onPointerEnter={(event) => {
          setIsHovered(true);
          updateInteractionPosition(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => updateInteractionPosition(event.clientX, event.clientY)}
        onPointerLeave={() => setIsHovered(false)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        className={`absolute touch-none select-none outline-none pointer-events-auto ${
          isVerticalRail
            ? 'left-0 top-0 h-full w-4 -translate-x-1/2 cursor-col-resize'
            : 'left-0 top-0 h-4 w-full -translate-y-1/2 cursor-row-resize'
        }`}
      >
        <div
          style={lineStyle}
          className={`pointer-events-none absolute ${
            isVerticalRail
              ? 'inset-y-0 left-1/2 w-px -translate-x-1/2'
              : 'inset-x-0 top-1/2 h-px -translate-y-1/2'
          } transition-opacity duration-200`}
        />
        <div
          style={handleStyle}
          className={`pointer-events-none absolute left-1/2 top-1/2 flex items-center justify-center rounded-full border backdrop-blur-sm transition-[opacity,background-color,border-color,color,box-shadow] duration-200 ${
            isVerticalRail
              ? 'h-16 w-3 -translate-x-1/2 -translate-y-1/2'
              : 'h-3 w-16 -translate-x-1/2 -translate-y-1/2'
          } ${
            isDragging
              ? 'border-primary-300/55 bg-primary-500/18 text-primary-200 opacity-100 shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_10px_30px_rgba(20,184,166,0.25)]'
              : isVisible
                ? 'border-white/20 bg-black/55 text-gray-100 opacity-100 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_10px_24px_rgba(0,0,0,0.28)]'
                : 'border-white/10 bg-black/35 text-gray-500 opacity-0 shadow-none'
          }`}
        >
          <div
            className="flex items-center justify-center transition-transform duration-200"
            style={{
              transform: isVerticalRail
                ? `scaleY(${handleMorphScale})`
                : `scaleX(${handleMorphScale})`,
            }}
          >
            <Icons.GripVertical className={`h-3.5 w-3.5 ${isVerticalRail ? '' : 'rotate-90'}`} />
          </div>
        </div>
        <div
          style={interactionPositionStyle}
          className={`pointer-events-none absolute z-10 rounded-full border border-white/10 bg-gray-950/88 px-2 py-1 shadow-[0_14px_36px_rgba(0,0,0,0.35)] ring-1 ring-inset ring-white/10 backdrop-blur-md transition-[opacity,transform] duration-150 ${
            isVerticalRail
              ? 'left-full top-1/2 ml-2 -translate-y-1/2'
              : 'bottom-full left-1/2 mb-2 -translate-x-1/2'
          } ${showTooltip ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
        >
          <div className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.2em] text-gray-500">
            {label}
          </div>
          <div className="mt-0.5 text-[11px] font-medium text-gray-100">{displayValue}</div>
        </div>
      </div>
    </div>
  );
};

export default SplitterHandle;
