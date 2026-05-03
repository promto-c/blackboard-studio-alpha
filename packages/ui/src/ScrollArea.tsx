import React from 'react';

/** Controls which direction the viewport may scroll. */
export type ScrollAreaAxis = 'x' | 'y' | 'both';

/**
 * Props for {@link ScrollArea}.
 *
 * `ScrollArea` has three layout layers:
 * - root: the positioned shell that owns overlays and scrollbar chrome
 * - viewport: the actual scrolling element (the forwarded ref points here)
 * - content: an optional inner wrapper for padding / spacing
 *
 * For new code, prefer the explicit `root*`, `viewport*`, and `content*` props.
 *
 * Backward compatibility:
 * - `containerClassName` / `containerStyle` still target the root
 * - `className` / `style` still target the viewport
 *
 * @example
 * Basic vertical scrolling that fills a flex layout
 * ```tsx
 * <ScrollArea fill axis="y" contentClassName="space-y-3 px-3 py-2">
 *   <SectionA />
 *   <SectionB />
 * </ScrollArea>
 * ```
 *
 * @example
 * Horizontal chip row with padding on the viewport
 * ```tsx
 * <ScrollArea axis="x" viewportClassName="pb-1" contentClassName="flex gap-2">
 *   {items.map((item) => (
 *     <Chip key={item.id} label={item.label} />
 *   ))}
 * </ScrollArea>
 * ```
 *
 * @example
 * Full control over root, viewport, and content layers
 * ```tsx
 * <ScrollArea
 *   fill
 *   axis="both"
 *   rootClassName="rounded-xl border border-white/10"
 *   viewportClassName="max-h-80 bg-gray-950/70"
 *   contentClassName="min-w-max p-3"
 * >
 *   <LargeCanvas />
 * </ScrollArea>
 * ```
 */
export interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Elements rendered inside the scrollable viewport. */
  children: React.ReactNode;

  /** Class applied to the outer root shell. */
  rootClassName?: string;

  /** Inline styles applied to the outer root shell. */
  rootStyle?: React.CSSProperties;

  /** Class applied to the scrollable viewport element. */
  viewportClassName?: string;

  /** Inline styles applied to the scrollable viewport element. */
  viewportStyle?: React.CSSProperties;

  /**
   * Class applied to an optional inner content wrapper.
   *
   * Use this for padding, gaps, or width constraints without affecting the viewport itself.
   */
  contentClassName?: string;

  /** Inline styles applied to the optional inner content wrapper. */
  contentStyle?: React.CSSProperties;

  /** Deprecated alias for `rootClassName`. Kept for backward compatibility. */
  containerClassName?: string;

  /** Deprecated alias for `rootStyle`. Kept for backward compatibility. */
  containerStyle?: React.CSSProperties;

  /** Controls which axis may scroll. When omitted, callers can still manage overflow via viewport classes. */
  axis?: ScrollAreaAxis;

  /**
   * Makes the root and viewport expand to fill the available flex space.
   *
   * This is the recommended mode for panel bodies, sidebars, and inspector sections.
   */
  fill?: boolean;

  /** Adds top and bottom edge fades that respond to scroll position. */
  fadeEdges?: boolean;
}

interface ScrollMetrics {
  hasOverflow: boolean;
  hasHorizontalOverflow: boolean;
  hasVerticalOverflow: boolean;
  canScrollDown: boolean;
  canScrollLeft: boolean;
  canScrollRight: boolean;
  canScrollUp: boolean;
  horizontalThumbOffset: number;
  horizontalThumbSize: number;
  verticalThumbOffset: number;
  verticalThumbSize: number;
}

interface HorizontalDragState {
  maxScrollLeft: number;
  pointerId: number;
  startClientX: number;
  startScrollLeft: number;
  thumbTravel: number;
}

interface VerticalDragState {
  maxScrollTop: number;
  pointerId: number;
  startClientY: number;
  startScrollTop: number;
  thumbTravel: number;
}

interface EdgeFadeAppearance {
  backgroundColor: string;
  bottomLeftRadius: string;
  bottomRightRadius: string;
  topLeftRadius: string;
  topRightRadius: string;
}

interface RgbaColor {
  a: number;
  b: number;
  g: number;
  r: number;
}

const STYLE_ELEMENT_ID = 'bb-scroll-area-styles';
const VIEWPORT_CLASS_NAME = 'bb-scroll-area__viewport';
const EDGE_HOTZONE_PX = 18;
const EDGE_FADE_SIZE_PX = 24;
const HIDE_AFTER_SCROLL_MS = 640;
const SCROLL_VISIBILITY_EPSILON_PX = 1;
const THUMB_EDGE_OFFSET_PX = 4;
const MIN_THUMB_SIZE_PX = 36;
const DEFAULT_EDGE_FADE_APPEARANCE: EdgeFadeAppearance = {
  backgroundColor: 'rgba(17, 24, 39, 0.92)',
  bottomLeftRadius: '0px',
  bottomRightRadius: '0px',
  topLeftRadius: '0px',
  topRightRadius: '0px',
};
const EMPTY_SCROLL_METRICS: ScrollMetrics = {
  hasOverflow: false,
  hasHorizontalOverflow: false,
  hasVerticalOverflow: false,
  canScrollDown: false,
  canScrollLeft: false,
  canScrollRight: false,
  canScrollUp: false,
  horizontalThumbOffset: 0,
  horizontalThumbSize: 0,
  verticalThumbOffset: 0,
  verticalThumbSize: 0,
};
const RGBA_COLOR_PATTERN =
  /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*(\d*(?:\.\d+)?)\s*)?\)$/i;
const AXIS_CLASS_NAMES: Record<ScrollAreaAxis, string> = {
  x: 'overflow-x-auto overflow-y-hidden',
  y: 'overflow-y-auto overflow-x-hidden',
  both: 'overflow-auto',
};

const joinClassNames = (...values: Array<string | undefined | false>) =>
  values.filter(Boolean).join(' ');

const ensureScrollAreaStyles = () => {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ELEMENT_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `
    .${VIEWPORT_CLASS_NAME} {
      -ms-overflow-style: none !important;
      scrollbar-width: none !important;
    }

    .${VIEWPORT_CLASS_NAME}::-webkit-scrollbar,
    .${VIEWPORT_CLASS_NAME}::-webkit-scrollbar-thumb,
    .${VIEWPORT_CLASS_NAME}::-webkit-scrollbar-track,
    .${VIEWPORT_CLASS_NAME}::-webkit-scrollbar-corner {
      width: 0 !important;
      height: 0 !important;
      display: none !important;
      background: transparent !important;
    }
  `;
  document.head.appendChild(style);
};

const clampChannel = (value: number) => Math.min(255, Math.max(0, value));

const parseRgbaColor = (value: string): RgbaColor | null => {
  const normalized = value.trim();
  if (!normalized || normalized === 'transparent') return null;

  const match = RGBA_COLOR_PATTERN.exec(normalized);
  if (!match) return null;

  return {
    r: clampChannel(Number(match[1])),
    g: clampChannel(Number(match[2])),
    b: clampChannel(Number(match[3])),
    a: match[4] === undefined || match[4] === '' ? 1 : Math.min(1, Math.max(0, Number(match[4]))),
  };
};

const compositeColors = (foreground: RgbaColor, background: RgbaColor): RgbaColor => {
  const a = foreground.a + background.a * (1 - foreground.a);
  if (a <= 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / a,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / a,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / a,
    a,
  };
};

const formatRgbaColor = (value: RgbaColor) =>
  `rgba(${Math.round(value.r)}, ${Math.round(value.g)}, ${Math.round(value.b)}, ${value.a.toFixed(3)})`;

const resolveEffectiveBackgroundColor = (element: HTMLElement): string => {
  const fallbackColor = parseRgbaColor(DEFAULT_EDGE_FADE_APPEARANCE.backgroundColor);
  const colors: RgbaColor[] = [];
  let currentElement: HTMLElement | null = element;

  while (currentElement) {
    const backgroundColor = parseRgbaColor(window.getComputedStyle(currentElement).backgroundColor);
    if (backgroundColor && backgroundColor.a > 0) {
      colors.push(backgroundColor);
    }

    currentElement = currentElement.parentElement;
  }

  let accumulated = fallbackColor ?? { r: 17, g: 24, b: 39, a: 0.92 };
  for (let index = colors.length - 1; index >= 0; index -= 1) {
    accumulated = compositeColors(colors[index], accumulated);
    if (accumulated.a >= 0.999) {
      break;
    }
  }

  return formatRgbaColor(accumulated);
};

/**
 * A custom scroll container with auto-hiding overlay thumbs and optional edge fades.
 *
 * The forwarded ref points to the viewport element, which is the real scrolling node.
 *
 * Recommended usage:
 * - use `fill` inside flex layouts
 * - use `axis` for the common `x` / `y` / `both` cases
 * - use `contentClassName` for spacing and item layout
 * - use `rootClassName` and `viewportClassName` only when you need precise control
 *
 * @example
 * Typical panel body
 * ```tsx
 * <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
 *   <PanelHeader />
 *   <ScrollArea fill axis="y" contentClassName="space-y-2 px-2 py-2">
 *     <PanelContent />
 *   </ScrollArea>
 * </div>
 * ```
 */
const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  (
    {
      children,
      className = '',
      containerClassName = '',
      containerStyle,
      contentClassName = '',
      contentStyle,
      axis,
      fadeEdges = false,
      fill = false,
      onBlur,
      onFocus,
      onPointerEnter,
      onPointerLeave,
      onPointerMove,
      rootClassName = '',
      rootStyle,
      onScroll,
      style,
      viewportClassName = '',
      viewportStyle,
      ...props
    },
    ref,
  ) => {
    const rootRef = React.useRef<HTMLDivElement | null>(null);
    const viewportRef = React.useRef<HTMLDivElement | null>(null);
    const horizontalDragStateRef = React.useRef<HorizontalDragState | null>(null);
    const hideTimerRef = React.useRef<number | null>(null);
    const verticalDragStateRef = React.useRef<VerticalDragState | null>(null);
    const [metrics, setMetrics] = React.useState<ScrollMetrics>(EMPTY_SCROLL_METRICS);
    const [edgeFadeAppearance, setEdgeFadeAppearance] = React.useState<EdgeFadeAppearance>(
      DEFAULT_EDGE_FADE_APPEARANCE,
    );
    const [isHovered, setIsHovered] = React.useState(false);
    const [isNearHorizontalEdge, setIsNearHorizontalEdge] = React.useState(false);
    const [isNearVerticalEdge, setIsNearVerticalEdge] = React.useState(false);
    const [isFocused, setIsFocused] = React.useState(false);
    const [isHorizontalDragging, setIsHorizontalDragging] = React.useState(false);
    const [isScrollActive, setIsScrollActive] = React.useState(false);
    const [isVerticalDragging, setIsVerticalDragging] = React.useState(false);

    React.useLayoutEffect(() => {
      ensureScrollAreaStyles();
    }, []);

    const setViewportRef = React.useCallback(
      (node: HTMLDivElement | null) => {
        viewportRef.current = node;
        if (typeof ref === 'function') {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      },
      [ref],
    );

    const clearHideTimer = React.useCallback(() => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    }, []);

    const scheduleHide = React.useCallback(() => {
      clearHideTimer();
      hideTimerRef.current = window.setTimeout(() => {
        setIsScrollActive(false);
      }, HIDE_AFTER_SCROLL_MS);
    }, [clearHideTimer]);

    const updateMetrics = React.useCallback(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      const hasVerticalOverflow = maxScrollTop > 0 && viewport.clientHeight > 0;
      const hasHorizontalOverflow = maxScrollLeft > 0 && viewport.clientWidth > 0;

      if (!hasVerticalOverflow && !hasHorizontalOverflow) {
        setMetrics((current) =>
          current.hasOverflow ||
          current.canScrollDown ||
          current.canScrollLeft ||
          current.canScrollRight ||
          current.canScrollUp
            ? EMPTY_SCROLL_METRICS
            : current,
        );
        return;
      }

      const verticalTrackHeight = Math.max(0, viewport.clientHeight - THUMB_EDGE_OFFSET_PX * 2);
      const verticalThumbSize = hasVerticalOverflow
        ? Math.max(
            MIN_THUMB_SIZE_PX,
            (viewport.clientHeight / viewport.scrollHeight) * verticalTrackHeight,
          )
        : 0;
      const verticalThumbTravel = Math.max(0, verticalTrackHeight - verticalThumbSize);
      const verticalThumbOffset =
        maxScrollTop === 0 ? 0 : (viewport.scrollTop / maxScrollTop) * verticalThumbTravel;
      const canScrollUp = hasVerticalOverflow && viewport.scrollTop > SCROLL_VISIBILITY_EPSILON_PX;
      const canScrollDown =
        hasVerticalOverflow && viewport.scrollTop < maxScrollTop - SCROLL_VISIBILITY_EPSILON_PX;

      const horizontalTrackWidth = Math.max(0, viewport.clientWidth - THUMB_EDGE_OFFSET_PX * 2);
      const horizontalThumbSize = hasHorizontalOverflow
        ? Math.max(
            MIN_THUMB_SIZE_PX,
            (viewport.clientWidth / viewport.scrollWidth) * horizontalTrackWidth,
          )
        : 0;
      const horizontalThumbTravel = Math.max(0, horizontalTrackWidth - horizontalThumbSize);
      const horizontalThumbOffset =
        maxScrollLeft === 0 ? 0 : (viewport.scrollLeft / maxScrollLeft) * horizontalThumbTravel;
      const canScrollLeft =
        hasHorizontalOverflow && viewport.scrollLeft > SCROLL_VISIBILITY_EPSILON_PX;
      const canScrollRight =
        hasHorizontalOverflow && viewport.scrollLeft < maxScrollLeft - SCROLL_VISIBILITY_EPSILON_PX;

      setMetrics((current) => {
        if (
          current.hasOverflow &&
          current.hasHorizontalOverflow === hasHorizontalOverflow &&
          current.hasVerticalOverflow === hasVerticalOverflow &&
          current.canScrollDown === canScrollDown &&
          current.canScrollLeft === canScrollLeft &&
          current.canScrollRight === canScrollRight &&
          current.canScrollUp === canScrollUp &&
          Math.abs(current.horizontalThumbOffset - horizontalThumbOffset) < 0.5 &&
          Math.abs(current.horizontalThumbSize - horizontalThumbSize) < 0.5 &&
          Math.abs(current.verticalThumbOffset - verticalThumbOffset) < 0.5 &&
          Math.abs(current.verticalThumbSize - verticalThumbSize) < 0.5
        ) {
          return current;
        }
        return {
          hasOverflow: true,
          hasHorizontalOverflow,
          hasVerticalOverflow,
          canScrollDown,
          canScrollLeft,
          canScrollRight,
          canScrollUp,
          horizontalThumbOffset,
          horizontalThumbSize,
          verticalThumbOffset,
          verticalThumbSize,
        };
      });
    }, []);

    const syncEdgeFadeAppearance = React.useCallback(() => {
      if (!fadeEdges || typeof window === 'undefined') return;

      const viewport = viewportRef.current;
      if (!viewport) return;

      const computedStyle = window.getComputedStyle(viewport);
      const nextAppearance = {
        backgroundColor: resolveEffectiveBackgroundColor(viewport),
        bottomLeftRadius:
          computedStyle.borderBottomLeftRadius || DEFAULT_EDGE_FADE_APPEARANCE.bottomLeftRadius,
        bottomRightRadius:
          computedStyle.borderBottomRightRadius || DEFAULT_EDGE_FADE_APPEARANCE.bottomRightRadius,
        topLeftRadius:
          computedStyle.borderTopLeftRadius || DEFAULT_EDGE_FADE_APPEARANCE.topLeftRadius,
        topRightRadius:
          computedStyle.borderTopRightRadius || DEFAULT_EDGE_FADE_APPEARANCE.topRightRadius,
      };

      setEdgeFadeAppearance((current) => {
        if (
          current.backgroundColor === nextAppearance.backgroundColor &&
          current.bottomLeftRadius === nextAppearance.bottomLeftRadius &&
          current.bottomRightRadius === nextAppearance.bottomRightRadius &&
          current.topLeftRadius === nextAppearance.topLeftRadius &&
          current.topRightRadius === nextAppearance.topRightRadius
        ) {
          return current;
        }

        return nextAppearance;
      });
    }, [fadeEdges]);

    React.useLayoutEffect(() => {
      updateMetrics();
      syncEdgeFadeAppearance();
    }, [children, className, fadeEdges, style, syncEdgeFadeAppearance, updateMetrics]);

    React.useEffect(() => {
      updateMetrics();
      syncEdgeFadeAppearance();

      const root = rootRef.current;
      const viewport = viewportRef.current;
      if (!root || !viewport || typeof ResizeObserver === 'undefined') {
        return;
      }

      const observer = new ResizeObserver(() => {
        updateMetrics();
        syncEdgeFadeAppearance();
      });
      observer.observe(root);
      observer.observe(viewport);

      return () => {
        observer.disconnect();
      };
    }, [syncEdgeFadeAppearance, updateMetrics]);

    React.useEffect(
      () => () => {
        clearHideTimer();
      },
      [clearHideTimer],
    );

    const handleRootPointerEnter = React.useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        setIsHovered(true);
        onPointerEnter?.(event);
      },
      [onPointerEnter],
    );

    const handleRootPointerLeave = React.useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        setIsHovered(false);
        setIsNearHorizontalEdge(false);
        setIsNearVerticalEdge(false);
        onPointerLeave?.(event);
      },
      [onPointerLeave],
    );

    const handleRootPointerMove = React.useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        const viewport = viewportRef.current;
        if (viewport) {
          const rect = viewport.getBoundingClientRect();
          const withinVerticalBounds = event.clientY >= rect.top && event.clientY <= rect.bottom;
          const nearRightEdge = rect.right - event.clientX <= EDGE_HOTZONE_PX;
          setIsNearVerticalEdge((current) => {
            const next = metrics.hasVerticalOverflow && withinVerticalBounds && nearRightEdge;
            return current === next ? current : next;
          });

          const withinHorizontalBounds = event.clientX >= rect.left && event.clientX <= rect.right;
          const nearBottomEdge = rect.bottom - event.clientY <= EDGE_HOTZONE_PX;
          setIsNearHorizontalEdge((current) => {
            const next = metrics.hasHorizontalOverflow && withinHorizontalBounds && nearBottomEdge;
            return current === next ? current : next;
          });
        }
        onPointerMove?.(event);
      },
      [metrics.hasHorizontalOverflow, metrics.hasVerticalOverflow, onPointerMove],
    );

    const handleRootFocus = React.useCallback(
      (event: React.FocusEvent<HTMLDivElement>) => {
        setIsFocused(true);
        onFocus?.(event);
      },
      [onFocus],
    );

    const handleRootBlur = React.useCallback(
      (event: React.FocusEvent<HTMLDivElement>) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          setIsFocused(false);
        }
        onBlur?.(event);
      },
      [onBlur],
    );

    const handleViewportScroll = React.useCallback(
      (event: React.UIEvent<HTMLDivElement>) => {
        setIsScrollActive(true);
        scheduleHide();
        updateMetrics();
        onScroll?.(event);
      },
      [onScroll, scheduleHide, updateMetrics],
    );

    const handleVerticalThumbPointerDown = React.useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        const viewport = viewportRef.current;
        if (!viewport || !metrics.hasVerticalOverflow) return;

        const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
        const thumbTravel = Math.max(
          1,
          viewport.clientHeight - THUMB_EDGE_OFFSET_PX * 2 - metrics.verticalThumbSize,
        );

        verticalDragStateRef.current = {
          maxScrollTop,
          pointerId: event.pointerId,
          startClientY: event.clientY,
          startScrollTop: viewport.scrollTop,
          thumbTravel,
        };

        setIsVerticalDragging(true);
        setIsNearVerticalEdge(true);
        setIsScrollActive(true);
        clearHideTimer();
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      [clearHideTimer, metrics.hasVerticalOverflow, metrics.verticalThumbSize],
    );

    const handleVerticalThumbPointerMove = React.useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        const viewport = viewportRef.current;
        const dragState = verticalDragStateRef.current;
        if (!viewport || !dragState || dragState.pointerId !== event.pointerId) return;

        event.preventDefault();
        const deltaY = event.clientY - dragState.startClientY;
        const nextScrollTop =
          dragState.startScrollTop + (deltaY * dragState.maxScrollTop) / dragState.thumbTravel;
        viewport.scrollTop = Math.min(dragState.maxScrollTop, Math.max(0, nextScrollTop));
      },
      [],
    );

    const handleHorizontalThumbPointerDown = React.useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        const viewport = viewportRef.current;
        if (!viewport || !metrics.hasHorizontalOverflow) return;

        const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
        const thumbTravel = Math.max(
          1,
          viewport.clientWidth - THUMB_EDGE_OFFSET_PX * 2 - metrics.horizontalThumbSize,
        );

        horizontalDragStateRef.current = {
          maxScrollLeft,
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startScrollLeft: viewport.scrollLeft,
          thumbTravel,
        };

        setIsHorizontalDragging(true);
        setIsNearHorizontalEdge(true);
        setIsScrollActive(true);
        clearHideTimer();
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      [clearHideTimer, metrics.hasHorizontalOverflow, metrics.horizontalThumbSize],
    );

    const handleHorizontalThumbPointerMove = React.useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        const viewport = viewportRef.current;
        const dragState = horizontalDragStateRef.current;
        if (!viewport || !dragState || dragState.pointerId !== event.pointerId) return;

        event.preventDefault();
        const deltaX = event.clientX - dragState.startClientX;
        const nextScrollLeft =
          dragState.startScrollLeft + (deltaX * dragState.maxScrollLeft) / dragState.thumbTravel;
        viewport.scrollLeft = Math.min(dragState.maxScrollLeft, Math.max(0, nextScrollLeft));
      },
      [],
    );

    const endVerticalDrag = React.useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (verticalDragStateRef.current?.pointerId !== event.pointerId) return;
        verticalDragStateRef.current = null;
        setIsVerticalDragging(false);
        scheduleHide();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      },
      [scheduleHide],
    );

    const endHorizontalDrag = React.useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (horizontalDragStateRef.current?.pointerId !== event.pointerId) return;
        horizontalDragStateRef.current = null;
        setIsHorizontalDragging(false);
        scheduleHide();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      },
      [scheduleHide],
    );

    const isVerticalThumbVisible =
      metrics.hasVerticalOverflow &&
      (isHovered || isFocused || isScrollActive || isVerticalDragging);
    const isVerticalThumbExpanded = isNearVerticalEdge || isVerticalDragging;
    const isHorizontalThumbVisible =
      metrics.hasHorizontalOverflow &&
      (isHovered || isFocused || isScrollActive || isHorizontalDragging);
    const isHorizontalThumbExpanded = isNearHorizontalEdge || isHorizontalDragging;
    const showTopFade = fadeEdges && metrics.hasVerticalOverflow && metrics.canScrollUp;
    const showBottomFade = fadeEdges && metrics.hasVerticalOverflow && metrics.canScrollDown;
    const content =
      contentClassName || contentStyle ? (
        <div className={contentClassName} style={contentStyle}>
          {children}
        </div>
      ) : (
        children
      );

    return (
      <div
        ref={rootRef}
        className={joinClassNames(
          'relative overflow-hidden',
          fill && 'flex min-h-0 min-w-0 flex-1 flex-col',
          containerClassName,
          rootClassName,
        )}
        onBlur={handleRootBlur}
        onFocus={handleRootFocus}
        onPointerEnter={handleRootPointerEnter}
        onPointerLeave={handleRootPointerLeave}
        onPointerMove={handleRootPointerMove}
        style={{
          ...containerStyle,
          ...rootStyle,
        }}
      >
        <div
          ref={setViewportRef}
          className={joinClassNames(
            VIEWPORT_CLASS_NAME,
            fill && 'min-h-0 min-w-0 flex-1',
            axis && AXIS_CLASS_NAMES[axis],
            className,
            viewportClassName,
          )}
          onScroll={handleViewportScroll}
          style={{
            ...style,
            ...viewportStyle,
            msOverflowStyle: 'none',
            scrollbarWidth: 'none',
          }}
          {...props}
        >
          {content}
        </div>

        {fadeEdges ? (
          <>
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-x-0 top-0 z-10 transition-opacity duration-150 ${
                showTopFade ? 'opacity-100' : 'opacity-0'
              }`}
              style={{
                background: `linear-gradient(to bottom, ${edgeFadeAppearance.backgroundColor}, transparent)`,
                borderTopLeftRadius: edgeFadeAppearance.topLeftRadius,
                borderTopRightRadius: edgeFadeAppearance.topRightRadius,
                height: `${EDGE_FADE_SIZE_PX}px`,
              }}
            />
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 transition-opacity duration-150 ${
                showBottomFade ? 'opacity-100' : 'opacity-0'
              }`}
              style={{
                background: `linear-gradient(to top, ${edgeFadeAppearance.backgroundColor}, transparent)`,
                borderBottomLeftRadius: edgeFadeAppearance.bottomLeftRadius,
                borderBottomRightRadius: edgeFadeAppearance.bottomRightRadius,
                height: `${EDGE_FADE_SIZE_PX}px`,
              }}
            />
          </>
        ) : null}

        {metrics.hasVerticalOverflow ? (
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 z-20">
            <div
              className={`absolute right-[3px] rounded-full transition-[opacity,width,background-color] ease-out ${
                isVerticalThumbExpanded ? 'w-2' : 'w-0.5'
              } ${isVerticalThumbVisible ? 'opacity-100' : 'opacity-0'} ${
                isVerticalThumbExpanded || isVerticalDragging
                  ? 'pointer-events-auto'
                  : 'pointer-events-none'
              } bg-white/20 hover:bg-white/30 active:bg-white/50 shadow-[0_0_0_1px_rgba(255,255,255,0.08)] touch-none`}
              onPointerCancel={endVerticalDrag}
              onPointerDown={handleVerticalThumbPointerDown}
              onPointerMove={handleVerticalThumbPointerMove}
              onPointerUp={endVerticalDrag}
              style={{
                height: `${metrics.verticalThumbSize}px`,
                top: `${THUMB_EDGE_OFFSET_PX + metrics.verticalThumbOffset}px`,
                transitionDuration: `${isVerticalThumbVisible ? 200 : 800}ms, 150ms, 150ms`,
              }}
            />
          </div>
        ) : null}

        {metrics.hasHorizontalOverflow ? (
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
            <div
              className={`absolute bottom-[3px] rounded-full transition-[opacity,height,background-color] ease-out ${
                isHorizontalThumbExpanded ? 'h-2' : 'h-0.5'
              } ${isHorizontalThumbVisible ? 'opacity-100' : 'opacity-0'} ${
                isHorizontalThumbExpanded || isHorizontalDragging
                  ? 'pointer-events-auto'
                  : 'pointer-events-none'
              } bg-white/20 hover:bg-white/30 active:bg-white/50 shadow-[0_0_0_1px_rgba(255,255,255,0.08)] touch-none`}
              onPointerCancel={endHorizontalDrag}
              onPointerDown={handleHorizontalThumbPointerDown}
              onPointerMove={handleHorizontalThumbPointerMove}
              onPointerUp={endHorizontalDrag}
              style={{
                left: `${THUMB_EDGE_OFFSET_PX + metrics.horizontalThumbOffset}px`,
                transitionDuration: `${isHorizontalThumbVisible ? 200 : 800}ms, 150ms, 150ms`,
                width: `${metrics.horizontalThumbSize}px`,
              }}
            />
          </div>
        ) : null}
      </div>
    );
  },
);

ScrollArea.displayName = 'ScrollArea';

export default ScrollArea;
