import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import HotkeyBadge from './HotkeyBadge';
import { looksLikeHotkeyCombo, splitHotkeyAlternatives } from '@/hotkeys';

type TooltipSegment = { type: 'text'; value: string } | { type: 'hotkeys'; combos: string[] };

interface ParsedTooltipLine {
  segments: TooltipSegment[];
}

interface ActiveTooltip {
  target: HTMLElement;
  text: string;
}

interface TooltipPosition {
  left: number;
  top: number;
  placement: 'top' | 'bottom';
}

const HOTKEY_GROUP_PATTERN = /\(([^()]+)\)/g;
const TOOLTIP_SHOW_DELAY_MS = 1000;
const VIEWPORT_PADDING_PX = 8;
const TOOLTIP_GAP_PX = 10;

const parseTooltipLine = (line: string): ParsedTooltipLine => {
  const segments: TooltipSegment[] = [];
  let lastIndex = 0;
  HOTKEY_GROUP_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = HOTKEY_GROUP_PATTERN.exec(line))) {
    const [fullMatch, group] = match;
    const before = line.slice(lastIndex, match.index);
    if (before) {
      segments.push({ type: 'text', value: before });
    }

    const candidate = group.trim();
    if (looksLikeHotkeyCombo(candidate)) {
      segments.push({ type: 'hotkeys', combos: splitHotkeyAlternatives(candidate) });
    } else {
      segments.push({ type: 'text', value: fullMatch });
    }

    lastIndex = match.index + fullMatch.length;
  }

  const trailing = line.slice(lastIndex);
  if (trailing) {
    segments.push({ type: 'text', value: trailing });
  }

  return { segments };
};

const parseTooltipText = (text: string): ParsedTooltipLine[] =>
  text.split('\n').map((line) => parseTooltipLine(line.trimEnd()));

const getTooltipTarget = (node: EventTarget | null): HTMLElement | null => {
  if (!(node instanceof HTMLElement)) return null;
  return node.closest<HTMLElement>('[title]');
};

const GlobalTooltipLayer: React.FC = () => {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const showTimerRef = useRef<number | null>(null);
  const activeTargetRef = useRef<HTMLElement | null>(null);
  const suppressedTitlesRef = useRef<WeakMap<HTMLElement, string>>(new WeakMap());
  const [tooltip, setTooltip] = useState<ActiveTooltip | null>(null);
  const [position, setPosition] = useState<TooltipPosition>({
    left: 0,
    top: 0,
    placement: 'top',
  });
  const [positionReady, setPositionReady] = useState(false);

  const restoreTitle = useCallback((target: HTMLElement | null) => {
    if (!target) return;

    const suppressedTitle = suppressedTitlesRef.current.get(target);
    if (!suppressedTitle) return;

    if (!target.hasAttribute('title')) {
      target.setAttribute('title', suppressedTitle);
    }
    suppressedTitlesRef.current.delete(target);
  }, []);

  const getAndSuppressTitle = useCallback((target: HTMLElement): string | null => {
    const rawTitle = target.getAttribute('title');
    if (rawTitle && rawTitle.trim()) {
      suppressedTitlesRef.current.set(target, rawTitle);
      target.removeAttribute('title');
      return rawTitle.trim();
    }

    const suppressed = suppressedTitlesRef.current.get(target);
    return suppressed?.trim() || null;
  }, []);

  const hideTooltip = useCallback(() => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }

    restoreTitle(activeTargetRef.current);
    activeTargetRef.current = null;
    setTooltip(null);
    setPositionReady(false);
  }, [restoreTitle]);

  const scheduleTooltip = useCallback(
    (target: HTMLElement, immediate: boolean) => {
      const text = getAndSuppressTitle(target);
      if (!text) return;

      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current);
      }

      if (activeTargetRef.current && activeTargetRef.current !== target) {
        restoreTitle(activeTargetRef.current);
      }

      activeTargetRef.current = target;

      const show = () => {
        setPositionReady(false);
        setTooltip({ target, text });
        showTimerRef.current = null;
      };

      if (immediate) {
        show();
        return;
      }

      showTimerRef.current = window.setTimeout(show, TOOLTIP_SHOW_DELAY_MS);
    },
    [getAndSuppressTitle, restoreTitle],
  );

  const updatePosition = useCallback(() => {
    if (!tooltip || !tooltipRef.current) return;

    if (!tooltip.target.isConnected) {
      hideTooltip();
      return;
    }

    const anchorRect = tooltip.target.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    let placement: TooltipPosition['placement'] = 'top';

    let top = anchorRect.top - tooltipRect.height - TOOLTIP_GAP_PX;
    if (top < VIEWPORT_PADDING_PX) {
      top = anchorRect.bottom + TOOLTIP_GAP_PX;
      placement = 'bottom';
    }

    let left = anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2;
    left = Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(window.innerWidth - tooltipRect.width - VIEWPORT_PADDING_PX, left),
    );

    top = Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(window.innerHeight - tooltipRect.height - VIEWPORT_PADDING_PX, top),
    );

    setPosition((current) => {
      if (
        Math.abs(current.left - left) < 0.5 &&
        Math.abs(current.top - top) < 0.5 &&
        current.placement === placement
      ) {
        return current;
      }
      return { left, top, placement };
    });

    setPositionReady(true);
  }, [hideTooltip, tooltip]);

  useEffect(() => {
    const handleMouseOver = (event: MouseEvent) => {
      const target = getTooltipTarget(event.target);
      if (!target || target === activeTargetRef.current) return;
      scheduleTooltip(target, false);
    };

    const handleMouseOut = (event: MouseEvent) => {
      const activeTarget = activeTargetRef.current;
      if (!activeTarget) return;

      if (!(event.target instanceof Node) || !activeTarget.contains(event.target)) return;

      const relatedTarget = event.relatedTarget as Node | null;
      if (relatedTarget && activeTarget.contains(relatedTarget)) return;

      hideTooltip();
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = getTooltipTarget(event.target);
      if (!target || target === activeTargetRef.current) return;
      scheduleTooltip(target, false);
    };

    const handleFocusOut = (event: FocusEvent) => {
      const activeTarget = activeTargetRef.current;
      if (!activeTarget) return;

      if (!(event.target instanceof Node) || !activeTarget.contains(event.target)) return;

      const relatedTarget = event.relatedTarget as Node | null;
      if (relatedTarget && activeTarget.contains(relatedTarget)) return;

      hideTooltip();
    };

    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);
    document.addEventListener('mousedown', hideTooltip, true);

    return () => {
      document.removeEventListener('mouseover', handleMouseOver, true);
      document.removeEventListener('mouseout', handleMouseOut, true);
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('focusout', handleFocusOut, true);
      document.removeEventListener('mousedown', hideTooltip, true);
    };
  }, [hideTooltip, scheduleTooltip]);

  useEffect(() => {
    if (!tooltip) return;

    const frame = requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [tooltip, updatePosition]);

  useEffect(() => {
    return () => {
      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current);
      }
      restoreTitle(activeTargetRef.current);
    };
  }, [restoreTitle]);

  const parsedLines = useMemo(() => (tooltip ? parseTooltipText(tooltip.text) : []), [tooltip]);

  if (!tooltip) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[999]">
      <div
        ref={tooltipRef}
        role="tooltip"
        className={`absolute max-w-[min(34rem,calc(100vw-1rem))] rounded-xl border border-white/15 bg-gradient-to-b from-gray-800/95 to-gray-950/95 px-3 py-2 text-[11px] leading-relaxed text-gray-100 shadow-[0_18px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl ring-1 ring-inset ring-white/10 animate-[fadeIn_120ms_ease-out] ${
          positionReady ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          left: `${position.left}px`,
          top: `${position.top}px`,
          visibility: positionReady ? 'visible' : 'hidden',
        }}
      >
        {parsedLines.map((line, lineIndex) => (
          <div
            key={`tooltip-line-${lineIndex}`}
            className={`${lineIndex > 0 ? 'mt-1' : ''} flex flex-wrap items-center gap-x-1 gap-y-1`}
          >
            {line.segments.length === 0 ? (
              <span className="h-[0.4rem]" />
            ) : (
              line.segments.map((segment, segmentIndex) => {
                if (segment.type === 'text') {
                  return (
                    <span key={`tooltip-segment-${lineIndex}-${segmentIndex}`}>
                      {segment.value}
                    </span>
                  );
                }

                return (
                  <span
                    key={`tooltip-segment-${lineIndex}-${segmentIndex}`}
                    className="inline-flex items-center gap-1"
                  >
                    {segment.combos.map((combo, comboIndex) => (
                      <React.Fragment key={`hotkey-${lineIndex}-${segmentIndex}-${comboIndex}`}>
                        <HotkeyBadge combo={combo} />
                        {comboIndex < segment.combos.length - 1 && (
                          <span className="text-gray-500">/</span>
                        )}
                      </React.Fragment>
                    ))}
                  </span>
                );
              })
            )}
          </div>
        ))}
        <div
          className={`absolute left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border border-white/15 bg-gray-900 ${
            position.placement === 'top'
              ? 'top-full -mt-[5px] border-t-0 border-l-0'
              : 'bottom-full -mb-[5px] border-r-0 border-b-0'
          }`}
        />
      </div>
    </div>,
    document.body,
  );
};

export default GlobalTooltipLayer;
