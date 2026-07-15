import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { useSelectedEditorNode } from '@/hooks/useEditorNodes';
import * as Icons from '@blackboard/icons';
import {
  SlidingSegmentedControl,
  type SlidingSegmentedControlOption,
} from '@/components/SlidingSegmentedControl';
import { NumberInput, ScrollArea } from '@blackboard/ui';
import { AnimatableNumber, Keyframe, SelectedKeyframeRef } from '@blackboard/types';
import GraphEditor from './GraphEditor';
import { useHotkeyScope } from '@/hotkeys';
import { usePreferences } from '@/state/preferencesContext';
import { useFrameScrubSession } from '@/hooks/useFrameScrubSession';
import { getAnimatableProperties, type AnimatablePropertyDef } from '@/nodes/animation';
// FIX: Added AnimatablePropertyDef to imports to resolve type inference issues in useMemo.
import { getSortedKeyframes, getValueAtFrame } from '@blackboard/renderer';
import { EditorTimelineHeight } from '@/utils/editorLayout';
import { useSmoothAnimation } from '@/hooks/useSmoothAnimation';
import { buildTimelineFrameSegments } from '@/utils/mediaTimelineStatus';

type VisibleTrack =
  | { type: 'group'; groupName: string; key: string }
  | { type: 'property'; property: AnimatablePropertyDef; key: string };

// --- CONSTANTS ---
const SIDEBAR_WIDTH = 260;
const TRACK_HEIGHT = 28;
const RULER_HEIGHT = 28;
const CACHE_INDICATOR_HEIGHT = 4;

const TRACK_BG_EVEN = '#1a1a1a';
const TRACK_BG_ODD = '#151515';
const KEYFRAME_COLOR = '#9CA3AF'; // gray-400
const KEYFRAME_SELECTED_COLOR = '#FACC15'; // yellow-400
const PLAYHEAD_COLOR = 'rgb(var(--color-primary-500))';
const OVERSCAN_ROWS = 6;

// Palette for per-node cache bars (cycles for many nodes)
const CACHE_NODE_COLORS = [
  '#10B981', // emerald — primary
  '#3B82F6', // blue
  '#8B5CF6', // violet
  '#F59E0B', // amber
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#84CC16', // lime
  '#F97316', // orange
];

interface NodeCacheBar {
  nodeId: string;
  nodeName: string;
  availableFrames: boolean[];
  cachedFrames: boolean[];
  cachingFrames: boolean[];
  color: string;
}
const TIMELINE_PANEL_CLASS =
  'glass-component flex flex-col overflow-hidden border-t border-gray-750 bg-gray-900/35 backdrop-blur-md';
const TIMELINE_TOP_BAR_CLASS =
  'flex items-center justify-between border-b border-white/10 bg-gray-900/35 px-2 backdrop-blur-md';
const TIMELINE_VIEW_ACTIVE_WIDTH = 68;
const TIMELINE_VIEW_INACTIVE_WIDTH = 28;
const TIMELINE_HEADER_CONTROL_HEIGHT = 28;

const getKeyframeId = (ref: SelectedKeyframeRef) => `${ref.nodeId}:${ref.path}:${ref.frame}`;
type TimelineCacheState = 'uncached' | 'caching' | 'cached';
type TimelineViewMode = 'dopesheet' | 'graph';

const getTimelineSpan = (startFrame: number, endFrame: number): number =>
  Math.max(0, endFrame - startFrame);

const getFramePercent = (frame: number, startFrame: number, endFrame: number): number => {
  const span = getTimelineSpan(startFrame, endFrame);
  return span > 0 ? ((frame - startFrame) / span) * 100 : 0;
};

const getTimelineCacheState = (
  frame: number,
  cachedFrames: boolean[],
  cachingFrames: boolean[],
): TimelineCacheState => {
  if (cachedFrames[frame]) return 'cached';
  if (cachingFrames[frame]) return 'caching';
  return 'uncached';
};

const buildTimelineCacheSegments = (
  timelineStartFrame: number,
  timelineEndFrame: number,
  cachedFrames: boolean[],
  cachingFrames: boolean[],
) => {
  const segments: Array<{
    start: number;
    end: number;
    state: Exclude<TimelineCacheState, 'uncached'>;
  }> = [];
  let activeState: Exclude<TimelineCacheState, 'uncached'> | null = null;
  let segmentStartFrame = timelineStartFrame;

  for (let frame = timelineStartFrame; frame <= timelineEndFrame; frame += 1) {
    const state = getTimelineCacheState(frame, cachedFrames, cachingFrames);
    if (state === activeState) continue;

    if (activeState) {
      segments.push({ start: segmentStartFrame, end: frame - 1, state: activeState });
    }

    activeState = state === 'uncached' ? null : state;
    segmentStartFrame = frame;
  }

  if (activeState) {
    segments.push({ start: segmentStartFrame, end: timelineEndFrame, state: activeState });
  }

  return segments;
};

interface TimelineProps {
  height: number;
  setHeight: (height: number) => void;
  minHeight: number;
}

function MiniTimelineScrubber({
  currentFrame,
  timelineStartFrame,
  maxFrames,
  keyframes,
  availableFrames,
  cachedFrames,
  cachingFrames,
  nodeCacheBars,
  timelineCacheMode,
  onSeek,
  setFrameScrubbing,
}: {
  currentFrame: number;
  timelineStartFrame: number;
  maxFrames: number;
  keyframes: number[];
  availableFrames: boolean[];
  cachedFrames: boolean[];
  cachingFrames: boolean[];
  nodeCacheBars: NodeCacheBar[];
  timelineCacheMode: 'consolidated' | 'separate';
  onSeek: (frame: number) => void;
  setFrameScrubbing: (isScrubbing: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverFrame, setHoverFrame] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ left: number; top: number } | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const showTimerRef = useRef<number | null>(null);
  const { startFrameScrubSession } = useFrameScrubSession({ setFrameScrubbing });

  // Clear timer on unmount
  useEffect(
    () => () => {
      if (showTimerRef.current !== null) window.clearTimeout(showTimerRef.current);
    },
    [],
  );
  const isConsolidated = timelineCacheMode === 'consolidated';
  const scrubberKeyframes = useMemo(
    () =>
      Array.from(
        new Set<number>(
          keyframes.filter((frame) => frame >= timelineStartFrame && frame <= maxFrames),
        ),
      ).sort((a, b) => a - b),
    [keyframes, maxFrames, timelineStartFrame],
  );
  const cacheSegments = useMemo(
    () => buildTimelineCacheSegments(timelineStartFrame, maxFrames, cachedFrames, cachingFrames),
    [cachedFrames, cachingFrames, maxFrames, timelineStartFrame],
  );
  const availabilitySegments = useMemo(
    () => buildTimelineFrameSegments(timelineStartFrame, maxFrames, availableFrames),
    [availableFrames, maxFrames, timelineStartFrame],
  );
  const separateBars = useMemo(
    () =>
      isConsolidated
        ? []
        : nodeCacheBars.map((bar) => ({
            ...bar,
            availabilitySegments: buildTimelineFrameSegments(
              timelineStartFrame,
              maxFrames,
              bar.availableFrames,
            ),
            segments: buildTimelineCacheSegments(
              timelineStartFrame,
              maxFrames,
              bar.cachedFrames,
              bar.cachingFrames,
            ),
          })),
    [nodeCacheBars, maxFrames, timelineStartFrame, isConsolidated],
  );

  const snapToNearestKeyframe = (frame: number) => {
    if (scrubberKeyframes.length === 0) return frame;
    let nearest = scrubberKeyframes[0];
    let bestDistance = Math.abs(frame - nearest);
    for (let i = 1; i < scrubberKeyframes.length; i++) {
      const candidate = scrubberKeyframes[i];
      const distance = Math.abs(frame - candidate);
      if (distance < bestDistance || (distance === bestDistance && candidate < nearest)) {
        nearest = candidate;
        bestDistance = distance;
      }
    }
    return nearest;
  };

  const getFrameFromClientX = (clientX: number) => {
    if (!containerRef.current) return 0;
    const rect = containerRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return timelineStartFrame + Math.round(ratio * getTimelineSpan(timelineStartFrame, maxFrames));
  };

  const handleSeek = (clientX: number, keyframesOnly = false) => {
    const frame = getFrameFromClientX(clientX);
    onSeek(keyframesOnly ? snapToNearestKeyframe(frame) : frame);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    handleSeek(e.clientX, e.shiftKey);
    startFrameScrubSession((event) => handleSeek(event.clientX, event.shiftKey));
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const frame = getFrameFromClientX(e.clientX);
    setHoverFrame(e.shiftKey ? snapToNearestKeyframe(frame) : frame);
    // Compute viewport-relative position for portaled tooltip
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const percent = getFramePercent(frame, timelineStartFrame, maxFrames);
      const left = rect.left + (percent / 100) * rect.width;
      const top = rect.top - (!isConsolidated && totalBars > 1 ? 120 : 60); // above scrubber component (consistent Y)
      setTooltipPos({ left, top });
    }
    // Schedule delayed show (match app tooltip timing)
    if (showTimerRef.current !== null) window.clearTimeout(showTimerRef.current);
    showTimerRef.current = window.setTimeout(() => setTooltipVisible(true), 800);
  };
  const handleMouseLeave = () => {
    if (showTimerRef.current !== null) window.clearTimeout(showTimerRef.current);
    showTimerRef.current = null;
    setHoverFrame(null);
    setTooltipPos(null);
    setTooltipVisible(false);
  };

  const percent = getFramePercent(currentFrame, timelineStartFrame, maxFrames);
  const hoverPercent =
    hoverFrame !== null ? getFramePercent(hoverFrame, timelineStartFrame, maxFrames) : 0;
  const hoverCacheState =
    hoverFrame !== null ? getTimelineCacheState(hoverFrame, cachedFrames, cachingFrames) : null;
  const hoverHasData = hoverFrame !== null && availableFrames[hoverFrame] === true;
  const totalBars = nodeCacheBars.length;

  return (
    <div
      ref={containerRef}
      className="relative h-4 flex-1 mx-2 cursor-pointer group flex items-center"
      title="Drag to seek. Hold Shift while dragging to jump between keyframes."
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Track Background */}
      <div className="absolute left-0 right-0 top-0 h-full overflow-hidden">
        {isConsolidated ? (
          /* ── Consolidated mode: single merged bar (vertically centered) ── */
          <div
            className="absolute left-0 right-0 h-[5px] rounded-sm overflow-hidden"
            style={{ top: '50%', transform: 'translateY(-50%)' }}
          >
            {/* Real source-data availability */}
            {availabilitySegments.map((segment) => {
              const frameCount = getTimelineSpan(timelineStartFrame, maxFrames) + 1;
              const left = ((segment.start - timelineStartFrame) / frameCount) * 100;
              const width = ((segment.end - segment.start + 1) / frameCount) * 100;
              return (
                <div
                  key={`available:${segment.start}-${segment.end}`}
                  className="absolute inset-y-0 rounded-full bg-gray-500/25"
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              );
            })}
            {/* Colored cache segments */}
            {cacheSegments.map((segment) => {
              const frameCount = getTimelineSpan(timelineStartFrame, maxFrames) + 1;
              const left = ((segment.start - timelineStartFrame) / frameCount) * 100;
              const width = ((segment.end - segment.start + 1) / frameCount) * 100;
              const colorClass =
                segment.state === 'cached' ? 'bg-emerald-300/30' : 'bg-amber-200/35';
              return (
                <div
                  key={`${segment.state}:${segment.start}-${segment.end}`}
                  className={`absolute top-0 bottom-0 rounded-full ${colorClass}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              );
            })}
          </div>
        ) : (
          /* ── Separate mode: equal-height stacked per-node bars ── */
          separateBars.map((bar, barIdx) => (
            <React.Fragment key={`sep-${bar.nodeId}`}>
              {bar.availabilitySegments.map((segment) => {
                const frameCount = getTimelineSpan(timelineStartFrame, maxFrames) + 1;
                const left = ((segment.start - timelineStartFrame) / frameCount) * 100;
                const width = ((segment.end - segment.start + 1) / frameCount) * 100;
                return (
                  <div
                    key={`${bar.nodeId}:available:${segment.start}-${segment.end}`}
                    className="absolute h-[3px] rounded-sm bg-gray-500/25"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      bottom: `${barIdx * 3}px`,
                    }}
                  />
                );
              })}
              {bar.segments.map((seg) => {
                const frameCount = getTimelineSpan(timelineStartFrame, maxFrames) + 1;
                const left = ((seg.start - timelineStartFrame) / frameCount) * 100;
                const width = ((seg.end - seg.start + 1) / frameCount) * 100;
                const opacity = seg.state === 'cached' ? '0.6' : '0.35';
                return (
                  <div
                    key={`${bar.nodeId}:${seg.state}:${seg.start}`}
                    className="absolute h-[3px] rounded-sm"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      bottom: `${barIdx * 3}px`,
                      backgroundColor: bar.color,
                      opacity,
                    }}
                  />
                );
              })}
            </React.Fragment>
          ))
        )}

        {hoverFrame !== null && (
          <div
            className="absolute top-[-3px] bottom-[-3px] w-px bg-white/25 transition-all duration-75"
            style={{ left: `${hoverPercent}%` }}
          />
        )}
      </div>

      {/* Keyframe Pips */}
      {maxFrames > 0 &&
        scrubberKeyframes.map((frame) => {
          if (frame > maxFrames) return null;
          const kfPercent = getFramePercent(frame, timelineStartFrame, maxFrames);
          return (
            <div
              key={frame}
              className="absolute h-1.5 w-[2px] bg-white/30 rounded-full pointer-events-none z-10"
              style={{ left: `${kfPercent}%` }}
            />
          );
        })}

      {/* Hit Area */}
      <div className="absolute inset-0 -top-2 -bottom-2 z-10" />

      {/* Thumb (Vertical Pill) */}
      <div
        className="absolute h-3.5 w-1 rounded-full shadow-sm transform -translate-x-1/2 pointer-events-none z-20 transition-all duration-75 bg-primary-400"
        style={{ left: `${percent}%` }}
      />

      {/* Tooltip (portaled to body for stacking above viewport, delayed show) */}
      {tooltipVisible &&
        tooltipPos &&
        createPortal(
          <div
            className="fixed pointer-events-none z-[999] font-mono whitespace-nowrap rounded-xl border border-white/15 bg-gradient-to-b from-gray-800/95 to-gray-950/95 px-3 py-2 text-[11px] leading-relaxed text-gray-100 shadow-[0_18px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl ring-1 ring-inset ring-white/10"
            style={{ left: tooltipPos.left, top: tooltipPos.top, transform: 'translateX(-50%)' }}
          >
            <div className="text-center mb-0.5">
              {hoverFrame}
              {!hoverHasData ? (
                <span className="ml-1 text-gray-500">no data</span>
              ) : hoverCacheState !== 'uncached' ? (
                <span className="ml-1 text-gray-400">{hoverCacheState}</span>
              ) : (
                ''
              )}
            </div>
            {!isConsolidated && totalBars > 1 && (
              <div className="border-t border-white/10 pt-0.5 mt-0.5 space-y-0.5">
                {nodeCacheBars.map((bar) => {
                  const barState = getTimelineCacheState(
                    hoverFrame,
                    bar.cachedFrames,
                    bar.cachingFrames,
                  );
                  const barHasData = bar.availableFrames[hoverFrame] === true;
                  return (
                    <div
                      key={bar.nodeId}
                      className="flex items-center gap-1.5 font-sans text-gray-300"
                    >
                      <span className="text-[10px]" style={{ color: bar.color }}>
                        ●
                      </span>
                      <span className="truncate max-w-[120px]">{bar.nodeName}</span>
                      <span className="ml-auto text-gray-400">
                        {!barHasData
                          ? 'no data'
                          : barState === 'cached'
                            ? 'ready'
                            : barState === 'caching'
                              ? '...'
                              : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Arrow */}
            <div className="absolute left-1/2 top-full -translate-x-1/2 -mt-[5px] h-2 w-2 rotate-45 border border-white/15 border-t-0 border-l-0 bg-gray-900" />
          </div>,
          document.body,
        )}
    </div>
  );
}

function Ruler({
  zoom,
  panX,
  width,
  timelineStartFrame,
  maxFrames,
  currentFrame,
  onSeek,
  availableFrames,
  cachedFrames,
  cachingFrames,
  nodeCacheBars,
  timelineCacheMode,
  setFrameScrubbing,
}: {
  zoom: number;
  panX: number;
  width: number;
  timelineStartFrame: number;
  maxFrames: number;
  currentFrame: number;
  onSeek: (frame: number) => void;
  availableFrames: boolean[];
  cachedFrames: boolean[];
  cachingFrames: boolean[];
  nodeCacheBars: NodeCacheBar[];
  timelineCacheMode: 'consolidated' | 'separate';
  setFrameScrubbing: (isScrubbing: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverFrame, setHoverFrame] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ left: number; top: number } | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const showTimerRef = useRef<number | null>(null);
  const [hoverInCacheZone, setHoverInCacheZone] = useState(false);
  const isConsolidated = timelineCacheMode === 'consolidated';
  const { startFrameScrubSession } = useFrameScrubSession({ setFrameScrubbing });

  // Clear timer on unmount
  useEffect(
    () => () => {
      if (showTimerRef.current !== null) window.clearTimeout(showTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, RULER_HEIGHT);

    // Draw background for ruler
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(0, 0, width, RULER_HEIGHT);

    ctx.fillStyle = '#737373';
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';

    const isConsolidated = timelineCacheMode === 'consolidated';
    const pixelsPerFrame = zoom;
    let step = 1;
    if (pixelsPerFrame < 5) step = 5;
    if (pixelsPerFrame < 2) step = 10;
    if (pixelsPerFrame < 0.5) step = 50;
    if (pixelsPerFrame < 0.1) step = 100;

    const firstVisibleFrame = timelineStartFrame + Math.floor(-panX / zoom);
    const lastVisibleFrame = timelineStartFrame + Math.floor((width - panX) / zoom);

    // Draw Cached Status Bars
    if (isConsolidated) {
      // ── Consolidated mode: source availability with cache state overlaid ──
      if (availableFrames.length > 0) {
        const y = RULER_HEIGHT - CACHE_INDICATOR_HEIGHT;
        for (let f = firstVisibleFrame; f <= lastVisibleFrame; f++) {
          if (f < timelineStartFrame || f > maxFrames || !availableFrames[f]) continue;
          const x = (f - timelineStartFrame) * zoom + panX;
          const w = Math.max(1, zoom + 0.5);
          const state = getTimelineCacheState(f, cachedFrames, cachingFrames);
          ctx.fillStyle = 'rgba(107, 114, 128, 0.25)'; // gray-500/25
          ctx.fillRect(x, y, w, CACHE_INDICATOR_HEIGHT);
          if (state === 'cached') {
            ctx.fillStyle = 'rgba(110, 231, 183, 0.3)'; // emerald-300/30
            ctx.fillRect(x, y, w, CACHE_INDICATOR_HEIGHT);
          } else if (state === 'caching') {
            ctx.fillStyle = 'rgba(253, 230, 138, 0.35)'; // amber-200/35
            ctx.fillRect(x, y, w, CACHE_INDICATOR_HEIGHT);
          }
        }
      }
    } else {
      // ── Separate mode: stacked per-node colored bars (soft style, matching frame slider) ──
      const SEPARATE_BAR_HEIGHT = 3;
      nodeCacheBars.forEach((bar, index) => {
        const {
          availableFrames: barAvailable,
          cachedFrames: barCached,
          cachingFrames: barCaching,
        } = bar;
        if (barAvailable.length === 0) return;

        const y = RULER_HEIGHT - CACHE_INDICATOR_HEIGHT - index * 2;

        for (let f = firstVisibleFrame; f <= lastVisibleFrame; f++) {
          if (f < timelineStartFrame || f > maxFrames || !barAvailable[f]) continue;
          const x = (f - timelineStartFrame) * zoom + panX;
          const w = Math.max(1, zoom + 0.5);
          const state = getTimelineCacheState(f, barCached, barCaching);
          ctx.fillStyle = 'rgba(107, 114, 128, 0.25)';
          ctx.fillRect(x, y, w, SEPARATE_BAR_HEIGHT);
          if (state !== 'uncached') {
            ctx.fillStyle = bar.color;
            ctx.globalAlpha = state === 'cached' ? 0.6 : 0.35;
            ctx.fillRect(x, y, w, SEPARATE_BAR_HEIGHT);
            ctx.globalAlpha = 1;
          }
        }
      });
    }

    ctx.beginPath();
    ctx.strokeStyle = '#404040';
    ctx.lineWidth = 1;

    const cacheZoneHeight = isConsolidated
      ? CACHE_INDICATOR_HEIGHT
      : CACHE_INDICATOR_HEIGHT + Math.max(0, (nodeCacheBars.length - 1) * 2);

    for (let f = firstVisibleFrame; f <= lastVisibleFrame; f++) {
      if (f < timelineStartFrame || f > maxFrames) continue;
      const x = (f - timelineStartFrame) * zoom + panX;

      if (f % step === 0) {
        const isMajor = f % (step * 2) === 0;
        const height = isMajor ? 12 : 6;
        ctx.moveTo(x + 0.5, RULER_HEIGHT - cacheZoneHeight);
        ctx.lineTo(x + 0.5, RULER_HEIGHT - cacheZoneHeight - height);

        if (isMajor) {
          // Reset fill to neutral gray — cache bar loops may have overridden ctx.fillStyle
          ctx.fillStyle = '#737373';
          ctx.fillText(f.toString(), x + 4, 12);
        }
      }
    }
    ctx.stroke();

    // Draw Playhead Indicator on Ruler
    const playheadX = (currentFrame - timelineStartFrame) * zoom + panX;

    // Resolve accent color from DOM (CSS var is not valid in canvas context)
    const accentRaw = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-primary-500')
      .trim();
    const accentColor = accentRaw ? `rgb(${accentRaw})` : 'rgb(20, 184, 166)';

    // Playhead arrow
    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.moveTo(playheadX, 4);
    ctx.lineTo(playheadX + 6, 4);
    ctx.lineTo(playheadX + 6, 16);
    ctx.lineTo(playheadX, 24); // point
    ctx.lineTo(playheadX - 6, 16);
    ctx.lineTo(playheadX - 6, 4);
    ctx.closePath();
    ctx.fill();

    // Playhead line connector
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(playheadX, 24);
    ctx.lineTo(playheadX, RULER_HEIGHT);
    ctx.stroke();
  }, [
    zoom,
    panX,
    width,
    timelineStartFrame,
    maxFrames,
    currentFrame,
    availableFrames,
    cachedFrames,
    cachingFrames,
    nodeCacheBars,
    timelineCacheMode,
  ]);

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();

    const seek = (clientX: number) => {
      const x = clientX - rect.left;
      const frame = timelineStartFrame + Math.round((x - panX) / zoom);
      onSeek(frame);
    };

    seek(e.clientX);
    startFrameScrubSession((event) => seek(event.clientX));
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const frame = timelineStartFrame + Math.round((x - panX) / zoom);
    const clamped = Math.max(timelineStartFrame, Math.min(maxFrames, frame));
    setHoverFrame(clamped);
    // Compute viewport-relative position for portaled tooltip
    const clampedX = Math.max(8, Math.min(width - 8, x));
    setTooltipPos({ left: rect.left + clampedX, top: rect.top - 24 }); // -top-6 ≈ 24px above (simple tooltip base)
    // Schedule delayed show (match app tooltip timing)
    if (showTimerRef.current !== null) window.clearTimeout(showTimerRef.current);
    showTimerRef.current = window.setTimeout(() => setTooltipVisible(true), 800);
    // Detect if hovering over the cache bar zone
    const cacheZoneHeight = isConsolidated
      ? CACHE_INDICATOR_HEIGHT
      : CACHE_INDICATOR_HEIGHT + Math.max(0, (nodeCacheBars.length - 1) * 2);
    setHoverInCacheZone(isConsolidated ? false : y > RULER_HEIGHT - cacheZoneHeight);
  };

  const handleMouseLeave = () => {
    if (showTimerRef.current !== null) window.clearTimeout(showTimerRef.current);
    showTimerRef.current = null;
    setHoverFrame(null);
    setTooltipPos(null);
    setTooltipVisible(false);
    setHoverInCacheZone(false);
  };

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        width={width}
        height={RULER_HEIGHT}
        className="block cursor-pointer border-b border-white/5"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {/* Ruler tooltips (portaled to body for stacking above viewport, delayed show) */}
      {tooltipVisible && tooltipPos
        ? !isConsolidated && hoverInCacheZone && nodeCacheBars.length > 1
          ? createPortal(
              <div
                className="fixed pointer-events-none z-[999] font-mono whitespace-nowrap rounded-xl border border-white/15 bg-gradient-to-b from-gray-800/95 to-gray-950/95 px-3 py-2 text-[11px] leading-relaxed text-gray-100 shadow-[0_18px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl ring-1 ring-inset ring-white/10"
                style={{
                  left: tooltipPos.left,
                  top: tooltipPos.top - 56,
                  transform: 'translateX(-50%)',
                }}
              >
                <div className="text-center text-gray-300 mb-0.5">Frame {hoverFrame}</div>
                <div className="border-t border-white/10 pt-0.5 space-y-0.5">
                  {nodeCacheBars.map((bar) => {
                    const barState = getTimelineCacheState(
                      hoverFrame,
                      bar.cachedFrames,
                      bar.cachingFrames,
                    );
                    const barHasData = bar.availableFrames[hoverFrame] === true;
                    return (
                      <div
                        key={bar.nodeId}
                        className="flex items-center gap-1.5 font-sans text-gray-300"
                      >
                        <span className="text-[10px]" style={{ color: bar.color }}>
                          ●
                        </span>
                        <span className="truncate max-w-[140px]">{bar.nodeName}</span>
                        <span className="ml-auto text-gray-400">
                          {!barHasData
                            ? 'no data'
                            : barState === 'cached'
                              ? 'ready'
                              : barState === 'caching'
                                ? '...'
                                : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {/* Arrow */}
                <div className="absolute left-1/2 top-full -translate-x-1/2 -mt-[5px] h-2 w-2 rotate-45 border border-white/15 border-t-0 border-l-0 bg-gray-900" />
              </div>,
              document.body,
            )
          : createPortal(
              <div
                className="fixed pointer-events-none z-[999] font-mono rounded-xl border border-white/15 bg-gradient-to-b from-gray-800/95 to-gray-950/95 px-3 py-2 text-[11px] leading-relaxed text-gray-100 shadow-[0_18px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl ring-1 ring-inset ring-white/10"
                style={{
                  left: tooltipPos.left,
                  top: tooltipPos.top,
                  transform: 'translateX(-50%)',
                }}
              >
                {hoverFrame}
                {/* Arrow */}
                <div className="absolute left-1/2 top-full -translate-x-1/2 -mt-[5px] h-2 w-2 rotate-45 border border-white/15 border-t-0 border-l-0 bg-gray-900" />
              </div>,
              document.body,
            )
        : null}
    </div>
  );
}

function KeyframeMarker({
  x,
  isSelected,
  onMouseDown,
}: {
  x: number;
  isSelected: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onMouseDown={onMouseDown}
      data-keyframe="true"
      className={`absolute top-1/2 -mt-1.5 w-3 h-3 transform rotate-45 cursor-col-resize shadow-sm z-10 transition-colors duration-75 hover:scale-125`}
      style={{
        left: x - 6,
        backgroundColor: isSelected ? KEYFRAME_SELECTED_COLOR : KEYFRAME_COLOR,
        border: isSelected ? '1px solid white' : '1px solid #171717',
      }}
    />
  );
}

function DopeSheetTrack({
  prop,
  zoom,
  panX,
  width,
  nodeId,
  path,
  timelineStartFrame,
  maxFrames,
  setSelectedKeyframes,
  onKeyframeMouseDown,
  isKeyframeSelected,
  updateKeyframe,
  onAddKeyframe,
  isEven,
  trackingData,
}: {
  prop: AnimatableNumber;
  zoom: number;
  panX: number;
  width: number;
  nodeId: string;
  path: string;
  timelineStartFrame: number;
  maxFrames: number;
  setSelectedKeyframes: (keyframes: SelectedKeyframeRef[]) => void;
  onKeyframeMouseDown: (e: React.MouseEvent, frame: number) => SelectedKeyframeRef[];
  isKeyframeSelected: (frame: number) => boolean;
  updateKeyframe: (nodeId: string, path: string, frame: number, updates: Partial<Keyframe>) => void;
  onAddKeyframe: (frame: number, value: number) => void;
  isEven: boolean;
  trackingData?: { [frame: number]: number };
}) {
  const keyframes = useMemo(() => getSortedKeyframes(prop), [prop]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragState, setDragState] = useState<{
    startX: number;
    primaryId: string;
    items: SelectedKeyframeRef[];
    originalFrames: Map<string, number>;
  } | null>(null);

  // Draw Tracking Data Heatmap
  useEffect(() => {
    if (!trackingData || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, TRACK_HEIGHT);

    // Find maximum error for normalization (peak finding)
    let maxError = 0;
    const frames = Object.keys(trackingData).map(Number);
    if (frames.length > 0) {
      for (const f of frames) {
        if (trackingData[f] > maxError) maxError = trackingData[f];
      }
    }

    // Normalize relative to the peak found in the data, with a minimum floor
    // This ensures that even small errors are visible if they are the largest ones,
    // but tiny noise (below 0.05) is suppressed.
    const peak = Math.max(maxError, 0.05);

    // Only draw if there's data in range
    const firstVisibleFrame = timelineStartFrame + Math.floor(-panX / zoom);
    const lastVisibleFrame = timelineStartFrame + Math.floor((width - panX) / zoom);

    for (let f = firstVisibleFrame; f <= lastVisibleFrame; f++) {
      if (Object.prototype.hasOwnProperty.call(trackingData, f)) {
        const error = trackingData[f];
        const x = (f - timelineStartFrame) * zoom + panX;
        const w = Math.max(1, zoom + 0.5);

        // Normalized value 0..1
        const normalized = Math.min(1, error / peak);

        // Color ramp: Green (120) -> Yellow (60) -> Red (0)
        const hue = 120 * (1 - normalized);

        ctx.fillStyle = `hsla(${hue}, 90%, 45%, 0.6)`;

        // Draw a height-variable bar to indicate error magnitude
        // Base height 4px, max full height
        const barHeight = 4 + normalized * (TRACK_HEIGHT - 6);
        const y = TRACK_HEIGHT - barHeight;

        ctx.fillRect(x, y, w, barHeight);
      }
    }
  }, [trackingData, width, panX, timelineStartFrame, zoom]);

  const handleMouseDown = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    const selection = onKeyframeMouseDown(e, keyframes[index].frame);
    const fallback: SelectedKeyframeRef = { nodeId, path, frame: keyframes[index].frame };
    const items = selection.length > 0 ? selection : [fallback];
    const primaryId = `${nodeId}:${path}:${keyframes[index].frame}`;
    const originalFrames = new Map<string, number>();
    items.forEach((item) => {
      originalFrames.set(`${item.nodeId}:${item.path}:${item.frame}`, item.frame);
    });
    setDragState({ startX: e.clientX, primaryId, items, originalFrames });
  };

  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragState.startX;
      const rawDelta = Math.round(dx / zoom);
      const frames = dragState.items.map(
        (item) =>
          dragState.originalFrames.get(`${item.nodeId}:${item.path}:${item.frame}`) ?? item.frame,
      );
      const minFrame = Math.min(...frames);
      const maxFrame = Math.max(...frames);

      const clampedDelta = Math.max(
        timelineStartFrame - minFrame,
        Math.min(maxFrames - maxFrame, rawDelta),
      );

      const nextSelection: SelectedKeyframeRef[] = [];
      const orderedItems = [...dragState.items].sort((a, b) => {
        const aOriginal =
          dragState.originalFrames.get(`${a.nodeId}:${a.path}:${a.frame}`) ?? a.frame;
        const bOriginal =
          dragState.originalFrames.get(`${b.nodeId}:${b.path}:${b.frame}`) ?? b.frame;
        return clampedDelta >= 0 ? bOriginal - aOriginal : aOriginal - bOriginal;
      });

      orderedItems.forEach((item) => {
        const original =
          dragState.originalFrames.get(`${item.nodeId}:${item.path}:${item.frame}`) ?? item.frame;
        const nextFrame = Math.max(
          timelineStartFrame,
          Math.min(maxFrames, original + clampedDelta),
        );
        nextSelection.push({ ...item, frame: nextFrame });
        updateKeyframe(item.nodeId, item.path, original, { frame: nextFrame });
      });

      setSelectedKeyframes(nextSelection);
    };

    const handleMouseUp = () => {
      setDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    dragState,
    keyframes,
    nodeId,
    path,
    updateKeyframe,
    zoom,
    timelineStartFrame,
    maxFrames,
    setSelectedKeyframes,
  ]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const frame = Math.max(
      timelineStartFrame,
      Math.min(maxFrames, timelineStartFrame + Math.round((x - panX) / zoom)),
    );
    const val = getValueAtFrame(prop, frame);
    onAddKeyframe(frame, val);
  };

  return (
    <div
      className="relative w-full h-full border-b border-white/5"
      style={{ backgroundColor: isEven ? TRACK_BG_EVEN : TRACK_BG_ODD }}
      onDoubleClick={handleDoubleClick}
    >
      {trackingData && (
        <canvas
          ref={canvasRef}
          width={width}
          height={TRACK_HEIGHT}
          className="absolute inset-0 pointer-events-none opacity-50"
        />
      )}
      {keyframes.map((kf, i) => {
        const x = (kf.frame - timelineStartFrame) * zoom + panX;
        if (x < -10 || x > width + 10) return null;
        return (
          <KeyframeMarker
            key={i}
            x={x}
            isSelected={isKeyframeSelected(kf.frame)}
            onMouseDown={(e) => handleMouseDown(e, i)}
          />
        );
      })}
    </div>
  );
}

function Timeline({ height, setHeight, minHeight }: TimelineProps) {
  const isPlaying = useEditorSelector((s) => s.isPlaying);
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const timelineStartFrame = useEditorSelector((s) => s.timelineStartFrame);
  const maxFrames = useEditorSelector((s) => s.maxFrames);
  const selectedNodeId = useEditorSelector((s) => s.selectedNodeId);
  const selectedRotoPathIds = useEditorSelector(
    (s) => s.hierarchySelections[s.selectedNodeId ?? '']?.itemIds ?? [],
  );
  const cacheStatus = useEditorSelector((s) => s.cacheStatus);
  const nodes = useEditorSelector((s) => s.nodes);
  const selectedKeyframes = useEditorSelector((s) => s.selectedKeyframes);
  const {
    playPause,
    seekFrame,
    setFrameScrubbing,
    setKeyframe,
    updateKeyframe,
    setSelectedKeyframes,
  } = useEditorActions();

  const [viewMode, setViewMode] = useState<TimelineViewMode>('dopesheet');
  const [panX, setPanX] = useState(40);
  const [zoom, setZoom] = useState(10);
  const [panY, setPanY] = useState(150);
  const [zoomY, setZoomY] = useState(10);
  const [scrollTop, setScrollTop] = useState(0);

  // --- Smooth zoom animation for dopesheet view (shared hook) ---
  const commitTimelineView = useCallback((v: { zoom: number; panX: number }) => {
    setZoom(v.zoom);
    setPanX(v.panX);
  }, []);

  const {
    targetRef: timelineTargetRef,
    scheduleAnimation: timelineScheduleAnimation,
    stopAnimation: timelineStopAnimation,
    snapTo: timelineSnapTo,
  } = useSmoothAnimation({ zoom, panX }, commitTimelineView);

  const timelineRef = useRef<HTMLDivElement>(null);
  const timelineRootRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [timelineWidth, setTimelineWidth] = useState(0);
  const [timelineViewportHeight, setTimelineViewportHeight] = useState(0);
  const [marqueeRect, setMarqueeRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const marqueeStateRef = useRef<{
    startX: number;
    startY: number;
    mode: 'add' | 'replace';
    baseSelection: SelectedKeyframeRef[];
  } | null>(null);
  const marqueeRectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(
    null,
  );
  useHotkeyScope({ id: 'timeline', ref: timelineRootRef });
  useHotkeyScope({
    id: viewMode === 'graph' ? 'timeline.graph' : 'timeline.dopesheet',
    parentId: 'timeline',
    ref: timelineRef,
  });

  const selectedNode = useSelectedEditorNode();
  const { timelineCacheMode } = usePreferences();

  // Lookup map for node names (id -> name)
  const nodeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    nodes.forEach((n) => map.set(n.id, n.name));
    return map;
  }, [nodes]);

  // Build merged cache status from ALL media nodes (viewport-scoped, not selection-scoped)
  const mergedCache = useMemo(() => {
    const entries = Object.values(cacheStatus.nodeEntries);
    if (entries.length === 0) {
      return {
        available: [] as boolean[],
        cached: [] as boolean[],
        caching: [] as boolean[],
      };
    }
    const available = new Array(maxFrames + 1).fill(false);
    const cached = new Array(maxFrames + 1).fill(false);
    const caching = new Array(maxFrames + 1).fill(false);
    for (const entry of entries) {
      for (let i = 0; i < (entry.availableFrames?.length ?? 0) && i <= maxFrames; i++) {
        if (entry.availableFrames[i]) available[i] = true;
      }
      for (let i = 0; i < entry.cachedFrames.length && i <= maxFrames; i++) {
        if (entry.cachedFrames[i]) cached[i] = true;
      }
      for (let i = 0; i < entry.cachingFrames.length && i <= maxFrames; i++) {
        if (entry.cachingFrames[i]) caching[i] = true;
      }
    }
    // Don't show caching for frames that are already cached
    for (let i = 0; i <= maxFrames; i++) {
      if (cached[i]) caching[i] = false;
    }
    return { available, cached, caching };
  }, [cacheStatus.nodeEntries, maxFrames]);

  // Build colored per-node cache bars (no selection-based sorting)
  const allNodeCacheBars = useMemo<NodeCacheBar[]>(() => {
    const entries = Object.entries(cacheStatus.nodeEntries);
    return entries.map(([nodeId, entry], index) => ({
      nodeId,
      nodeName: nodeNameMap.get(nodeId) ?? 'Unknown',
      availableFrames: entry.availableFrames ?? [],
      cachedFrames: entry.cachedFrames,
      cachingFrames: entry.cachingFrames,
      color: CACHE_NODE_COLORS[index % CACHE_NODE_COLORS.length],
    }));
  }, [cacheStatus.nodeEntries, nodeNameMap]);

  // Group properties
  const groupedProps = useMemo(() => {
    // FIX: Pass selectedRotoPathIds to getAnimatableProperties to filter tracks for roto nodes.
    const rawProps = getAnimatableProperties(selectedNode, { selectedRotoPathIds });
    const groups: Record<string, typeof rawProps> = {};

    // Default group if none
    rawProps.forEach((p) => {
      const g = p.group || 'General';
      if (!groups[g]) groups[g] = [];
      groups[g].push(p);
    });

    return groups;
  }, [selectedNode, selectedRotoPathIds]);

  // Aggregate unique keyframe frame numbers for the scrubber
  const allKeyframesForSelectedNode = useMemo(() => {
    const uniqueFrames = new Set<number>();
    // FIX: Cast elements to AnimatablePropertyDef to resolve TypeScript "unknown" type errors on lines 375 and 376 where type inference on .flat() was losing context.
    (Object.values(groupedProps).flat() as AnimatablePropertyDef[]).forEach((p) => {
      if (Array.isArray(p.prop)) {
        p.prop.forEach((kf: Keyframe) => uniqueFrames.add(kf.frame));
      }
    });
    return Array.from(uniqueFrames).sort((a, b) => a - b);
  }, [groupedProps]);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Initialize collapsed groups for Roto shapes by default to reduce clutter
  useEffect(() => {
    const initialCollapsed = new Set<string>();
    Object.keys(groupedProps).forEach((groupName) => {
      // Simple heuristic: if it contains "Shape", default to collapsed.
      // In getAnimatableProperties, roto groups are named by the shape name (e.g. "Shape 1")
      // We want to collapse them so only the header (which acts as master) is visible initially.
      // Wait, standard behavior is: if collapsed, only header is shown. If expanded, header + children.
      // If we want "Shape Item" to be the master track, we need it to be *inside* the group but always visible?
      // No, the header IS just a header in this implementation.
      // However, getAnimatableProperties adds "Path Animation" as the first property of the group.
      // So we should default to *collapsed* so the user clicks to expand.
      // Actually, the user asked "default show only shape item".
      // If I collapse it, they see only the group header.
      // If I expand it, they see "Path Animation" (Master) + Points.
      // Let's default to collapsed so the UI is clean.
      if (groupName.startsWith('Shape') || groupName.includes('Geometry')) {
        initialCollapsed.add(groupName);
      }
    });
    setCollapsedGroups(initialCollapsed);
  }, [groupedProps]); // Re-eval on groupedProps change

  const toggleGroup = (group: string) => {
    const newSet = new Set(collapsedGroups);
    if (newSet.has(group)) newSet.delete(group);
    else newSet.add(group);
    setCollapsedGroups(newSet);
  };

  const [selectedProperty, setSelectedProperty] = useState<string | null>(null);
  const selectedKeyframeSet = useMemo(
    () => new Set(selectedKeyframes.map(getKeyframeId)),
    [selectedKeyframes],
  );

  const flatProps = useMemo(
    () => Object.values(groupedProps).flat() as AnimatablePropertyDef[],
    [groupedProps],
  );
  const keyframesByPath = useMemo(() => {
    const map = new Map<string, Keyframe[]>();
    flatProps.forEach((prop) => {
      if (Array.isArray(prop.prop)) {
        map.set(prop.path, getSortedKeyframes(prop.prop));
      }
    });
    return map;
  }, [flatProps]);

  // Ensure selection validity
  useEffect(() => {
    const allPaths = Object.values(groupedProps)
      .flat()
      .map((p: AnimatablePropertyDef) => p.path);
    if (allPaths.length > 0 && (!selectedProperty || !allPaths.includes(selectedProperty))) {
      setSelectedProperty(allPaths[0]);
    } else if (allPaths.length === 0) {
      setSelectedProperty(null);
    }
  }, [groupedProps, selectedProperty]);

  useEffect(() => {
    if (!selectedNodeId) {
      if (selectedKeyframes.length > 0) {
        setSelectedKeyframes([]);
      }
      return;
    }
    const validPaths = new Set(flatProps.map((p) => p.path));
    const filtered = selectedKeyframes.filter(
      (kf) => kf.nodeId === selectedNodeId && validPaths.has(kf.path),
    );
    if (filtered.length !== selectedKeyframes.length) {
      setSelectedKeyframes(filtered);
    }
  }, [selectedNodeId, flatProps, selectedKeyframes, setSelectedKeyframes]);

  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const updateSize = () => {
      setTimelineWidth(el.clientWidth);
      setTimelineViewportHeight(el.clientHeight);
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [height, minHeight]);

  const isKeyframeSelected = useCallback(
    (path: string, frame: number) => {
      if (!selectedNodeId) return false;
      return selectedKeyframeSet.has(getKeyframeId({ nodeId: selectedNodeId, path, frame }));
    },
    [selectedNodeId, selectedKeyframeSet],
  );

  const handleKeyframeMouseDown = useCallback(
    (e: React.MouseEvent, ref: SelectedKeyframeRef) => {
      if (!selectedNodeId) return [];
      const isMulti = e.shiftKey || e.ctrlKey || e.metaKey;
      const key = getKeyframeId(ref);
      const isSelected = selectedKeyframeSet.has(key);

      let nextSelection: SelectedKeyframeRef[] = selectedKeyframes;
      if (isMulti) {
        if (isSelected) {
          nextSelection = selectedKeyframes.filter((kf) => getKeyframeId(kf) !== key);
        } else {
          nextSelection = [...selectedKeyframes, ref];
        }
      } else if (!isSelected) {
        nextSelection = [ref];
      }

      setSelectedKeyframes(nextSelection);
      return nextSelection;
    },
    [selectedNodeId, selectedKeyframes, selectedKeyframeSet, setSelectedKeyframes],
  );

  // Memoize handleWheel so it doesn't need to be recreated on every render
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.altKey) {
        // Zoom
        e.preventDefault();
        const zoomSpeed = 0.001;
        const target = timelineTargetRef.current;
        const newZoom = Math.max(0.1, Math.min(100, target.zoom * (1 - e.deltaY * zoomSpeed)));
        const rect = e.currentTarget.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const timeAtMouse = (mouseX - target.panX) / target.zoom;
        const newPanX = mouseX - timeAtMouse * newZoom;
        timelineTargetRef.current = { zoom: newZoom, panX: newPanX };
        timelineScheduleAnimation();
      } else if (e.shiftKey) {
        // Horizontal Pan
        e.preventDefault();
        // Snap to animation target first so the pan feels immediate
        const target = timelineTargetRef.current;
        timelineStopAnimation();
        timelineSnapTo({ zoom: target.zoom, panX: target.panX - e.deltaY });
      }
      // Normal wheel falls through to vertical scroll of the container
    },
    [timelineScheduleAnimation, timelineStopAnimation, timelineSnapTo, timelineTargetRef],
  );

  const handlePanDrag = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      // Snap to animation target first
      const target = timelineTargetRef.current;
      timelineStopAnimation();
      timelineSnapTo(target);

      const startX = e.clientX;
      const startPanX = target.panX;
      const handleMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const newPanX = startPanX + dx;
        timelineSnapTo({ zoom: timelineTargetRef.current.zoom, panX: newPanX });
      };
      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const nextScrollTop = e.currentTarget.scrollTop;
    setScrollTop(nextScrollTop);
    if (sidebarRef.current && sidebarRef.current.scrollTop !== nextScrollTop) {
      sidebarRef.current.scrollTop = nextScrollTop;
    }
  };

  const handleSidebarScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const nextScrollTop = e.currentTarget.scrollTop;
    setScrollTop(nextScrollTop);
    if (timelineRef.current && timelineRef.current.scrollTop !== nextScrollTop) {
      timelineRef.current.scrollTop = nextScrollTop;
    }
  };

  const isCollapsed = height <= minHeight + 20;

  const visibleTracks = useMemo(() => {
    const tracks: VisibleTrack[] = [];
    Object.entries(groupedProps).forEach(([groupName, props]) => {
      const typedProps = props as AnimatablePropertyDef[];
      tracks.push({ type: 'group', groupName, key: groupName });
      if (!collapsedGroups.has(groupName)) {
        typedProps.forEach((p) => {
          tracks.push({ type: 'property', property: p, key: p.path });
        });
      } else {
        if (groupName.startsWith('Shape') && typedProps.length > 0) {
          const masterProp = typedProps[0];
          if (masterProp.name === 'Path Animation') {
            tracks.push({ type: 'property', property: masterProp, key: masterProp.path });
          }
        }
      }
    });
    return tracks;
  }, [groupedProps, collapsedGroups]);

  const totalRows = visibleTracks.length;
  const startRow = Math.max(0, Math.floor(scrollTop / TRACK_HEIGHT) - OVERSCAN_ROWS);
  const endRow = Math.min(
    totalRows,
    Math.ceil((scrollTop + timelineViewportHeight) / TRACK_HEIGHT) + OVERSCAN_ROWS,
  );
  const visibleSlice = visibleTracks.slice(startRow, endRow);
  const sliceOffsetY = startRow * TRACK_HEIGHT;
  const totalHeight = totalRows * TRACK_HEIGHT;

  const trackRowIndexByPath = useMemo(() => {
    const map = new Map<string, number>();
    visibleTracks.forEach((item, index) => {
      if (item.type === 'property') {
        map.set(item.property.path, index);
      }
    });
    return map;
  }, [visibleTracks]);

  const getKeyframesInRect = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => {
      if (!selectedNodeId) return [];
      const hits: SelectedKeyframeRef[] = [];
      const xMin = rect.x;
      const xMax = rect.x + rect.width;
      const yMin = rect.y;
      const yMax = rect.y + rect.height;

      keyframesByPath.forEach((frames, path) => {
        const rowIndex = trackRowIndexByPath.get(path);
        if (rowIndex === undefined) return;
        const y = rowIndex * TRACK_HEIGHT + TRACK_HEIGHT / 2;
        if (y < yMin || y > yMax) return;
        frames.forEach((kf) => {
          const x = (kf.frame - timelineStartFrame) * zoom + panX;
          if (x >= xMin && x <= xMax) {
            hits.push({ nodeId: selectedNodeId, path, frame: kf.frame });
          }
        });
      });

      return hits;
    },
    [keyframesByPath, trackRowIndexByPath, zoom, panX, selectedNodeId, timelineStartFrame],
  );

  const handleContentMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if (viewMode !== 'dopesheet') return;
      if ((e.target as HTMLElement).closest('[data-keyframe="true"]')) return;
      if (!contentRef.current) return;

      const rect = contentRef.current.getBoundingClientRect();
      const startX = e.clientX - rect.left;
      const startY = e.clientY - rect.top;
      const mode = e.shiftKey || e.ctrlKey || e.metaKey ? 'add' : 'replace';
      const baseSelection = mode === 'add' ? selectedKeyframes : [];

      marqueeStateRef.current = { startX, startY, mode, baseSelection };

      if (mode === 'replace') {
        setSelectedKeyframes([]);
      }

      const initialRect = { x: startX, y: startY, width: 0, height: 0 };
      marqueeRectRef.current = initialRect;
      setMarqueeRect(initialRect);

      const handleMove = (ev: MouseEvent) => {
        if (!contentRef.current || !marqueeStateRef.current) return;
        const bounds = contentRef.current.getBoundingClientRect();
        const currentX = ev.clientX - bounds.left;
        const currentY = ev.clientY - bounds.top;
        const x = Math.min(startX, currentX);
        const y = Math.min(startY, currentY);
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);
        const nextRect = { x, y, width, height };
        marqueeRectRef.current = nextRect;
        setMarqueeRect(nextRect);
      };

      const handleUp = () => {
        const rect = marqueeRectRef.current;
        if (marqueeStateRef.current && rect) {
          const { mode: finalMode, baseSelection: base } = marqueeStateRef.current;
          const hits = getKeyframesInRect(rect);
          if (finalMode === 'add') {
            const merged: SelectedKeyframeRef[] = [...base];
            const set = new Set(base.map(getKeyframeId));
            hits.forEach((hit) => {
              const id = getKeyframeId(hit);
              if (!set.has(id)) {
                set.add(id);
                merged.push(hit);
              }
            });
            setSelectedKeyframes(merged);
          } else {
            setSelectedKeyframes(hits);
          }
        }
        marqueeStateRef.current = null;
        marqueeRectRef.current = null;
        setMarqueeRect(null);
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
      };

      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
    },
    [selectedKeyframes, setSelectedKeyframes, getKeyframesInRect, viewMode],
  );

  const clampFrame = (frame: number) => {
    if (!Number.isFinite(frame)) return timelineStartFrame;
    return Math.max(timelineStartFrame, Math.min(maxFrames, Math.round(frame)));
  };

  const seekClamped = (frame: number) => {
    seekFrame(clampFrame(frame));
  };

  const frameFieldDigitCount = Math.max(
    1,
    String(timelineStartFrame).length,
    String(maxFrames).length,
  );
  const frameFieldWidth = `calc(${frameFieldDigitCount * 2 + 3}ch + 1.5rem)`;

  const timelineViewOptions = useMemo<SlidingSegmentedControlOption<TimelineViewMode>[]>(
    () => [
      {
        value: 'dopesheet',
        label: 'Sheet',
        Icon: Icons.Bars4,
        title: isCollapsed ? 'Open Dope Sheet View' : 'Dope Sheet View',
      },
      {
        value: 'graph',
        label: 'Curve',
        Icon: Icons.Curve,
        title: isCollapsed ? 'Open Curve Editor View' : 'Curve Editor View',
      },
    ],
    [isCollapsed],
  );

  const openTimelineView = (mode: TimelineViewMode) => {
    if (!isCollapsed && viewMode === mode) {
      setHeight(minHeight);
      return;
    }

    setViewMode(mode);
    if (isCollapsed) {
      setHeight(320);
    }
  };

  return (
    <div
      ref={timelineRootRef}
      className={`${TIMELINE_PANEL_CLASS} select-none text-xs font-sans`}
      style={{ height, minHeight }}
    >
      {/* --- HEADER / CONTROLLER --- */}
      <div
        className={`${TIMELINE_TOP_BAR_CLASS} flex-shrink-0 z-20`}
        style={{ height: EditorTimelineHeight.DEFAULT }}
      >
        {/* Center: Transport Controls & Scrubber */}
        <div className="flex-1 flex items-center justify-center gap-2">
          <div
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-white/10 bg-black/20 px-1"
            style={{ height: TIMELINE_HEADER_CONTROL_HEIGHT }}
          >
            <div className="flex flex-shrink-0 items-center gap-0.5">
              <button
                onClick={() => seekClamped(timelineStartFrame)}
                className="rounded p-1 text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
                title={`Start (${timelineStartFrame})`}
              >
                <Icons.SkipStart className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => seekClamped(currentFrame - 1)}
                className="rounded p-1 text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
                title="Previous Frame"
              >
                <Icons.StepBackward className="h-3.5 w-3.5" />
              </button>

              <button
                onClick={playPause}
                className={`mx-1 flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
                  isPlaying
                    ? 'bg-primary-500/20 border border-primary-500/60 text-white shadow-sm'
                    : 'text-gray-200 hover:bg-white/5 hover:text-white'
                }`}
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              >
                {isPlaying ? (
                  <Icons.Pause className="h-3.5 w-3.5" />
                ) : (
                  <Icons.Play className="ml-0.5 h-3.5 w-3.5" />
                )}
              </button>

              <button
                onClick={() => seekClamped(currentFrame + 1)}
                className="rounded p-1 text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
                title="Next Frame"
              >
                <Icons.StepForward className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => seekClamped(maxFrames)}
                className="rounded p-1 text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
                title="End"
              >
                <Icons.SkipEnd className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="h-3 w-px flex-shrink-0 bg-white/10" />

            <MiniTimelineScrubber
              currentFrame={currentFrame}
              timelineStartFrame={timelineStartFrame}
              maxFrames={maxFrames}
              keyframes={allKeyframesForSelectedNode}
              availableFrames={mergedCache.available}
              cachedFrames={mergedCache.cached}
              cachingFrames={mergedCache.caching}
              nodeCacheBars={allNodeCacheBars}
              timelineCacheMode={timelineCacheMode}
              onSeek={seekClamped}
              setFrameScrubbing={setFrameScrubbing}
            />
          </div>
          <div className="flex-shrink-0" style={{ width: frameFieldWidth }}>
            <NumberInput
              value={currentFrame}
              min={timelineStartFrame}
              max={maxFrames}
              step={1}
              normalizeValue={Math.round}
              onValueChange={seekClamped}
              suffix={
                <span className="font-mono text-[11px] font-normal tabular-nums text-gray-500">
                  / {maxFrames}
                </span>
              }
              className="!min-h-0 !rounded-md !bg-black/20 !px-2 !py-0 !pr-14 !text-[11px]"
              style={{
                height: TIMELINE_HEADER_CONTROL_HEIGHT,
                minHeight: TIMELINE_HEADER_CONTROL_HEIGHT,
              }}
              aria-label={`Current timeline frame, maximum ${maxFrames}`}
            />
          </div>
          <SlidingSegmentedControl
            options={timelineViewOptions}
            value={isCollapsed ? null : viewMode}
            onChange={openTimelineView}
            activeWidth={TIMELINE_VIEW_ACTIVE_WIDTH}
            inactiveWidth={TIMELINE_VIEW_INACTIVE_WIDTH}
            height={TIMELINE_HEADER_CONTROL_HEIGHT}
          />
        </div>
      </div>
      {/* --- MAIN AREA --- */}
      {!isCollapsed && (
        <div className="flex-1 flex flex-col min-h-0 relative">
          {/* RULER ROW (Fixed Vertically) */}
          <div
            className="z-10 flex flex-shrink-0 border-b border-white/10 bg-gray-900/35 backdrop-blur-sm supports-[backdrop-filter]:bg-gray-900/20"
            style={{ height: RULER_HEIGHT }}
          >
            {/* Sidebar Header Spacer */}
            <div
              style={{ width: SIDEBAR_WIDTH }}
              className="z-20 flex flex-shrink-0 items-center justify-between border-r border-white/10 bg-gray-900/35 px-4 shadow-sm backdrop-blur-sm supports-[backdrop-filter]:bg-gray-900/20"
            >
              <span className="text-gray-400 font-medium text-[10px] uppercase tracking-wider">
                Property
              </span>
              <span className="text-gray-500 font-medium text-[10px] uppercase tracking-wider">
                Value
              </span>
            </div>
            {/* Ruler Canvas */}
            <div className="flex-1 relative overflow-hidden">
              <Ruler
                zoom={zoom}
                panX={panX}
                width={timelineWidth}
                timelineStartFrame={timelineStartFrame}
                maxFrames={maxFrames}
                currentFrame={currentFrame}
                onSeek={seekClamped}
                availableFrames={mergedCache.available}
                cachedFrames={mergedCache.cached}
                cachingFrames={mergedCache.caching}
                nodeCacheBars={allNodeCacheBars}
                timelineCacheMode={timelineCacheMode}
                setFrameScrubbing={setFrameScrubbing}
              />
            </div>
          </div>

          {/* SCROLLABLE BODY */}
          <div className="flex-1 flex relative overflow-hidden">
            {/* SIDEBAR (Tracks) */}
            <ScrollArea
              ref={sidebarRef}
              rootClassName="flex-shrink-0 min-h-0 z-10"
              rootStyle={{ width: SIDEBAR_WIDTH }}
              className="flex h-full flex-col overflow-auto border-r border-white/10 bg-gray-900/25 shadow-lg backdrop-blur-sm supports-[backdrop-filter]:bg-gray-900/12"
              onScroll={handleSidebarScroll}
            >
              {totalRows === 0 ? (
                <div className="p-6 text-center">
                  <p className="text-gray-500 text-xs italic">No animated tracks</p>
                  <p className="text-gray-600 text-[10px] mt-1">Select a node to view properties</p>
                </div>
              ) : (
                <div className="relative" style={{ height: totalHeight }}>
                  <div
                    className="absolute inset-x-0"
                    style={{ transform: `translateY(${sliceOffsetY}px)` }}
                  >
                    {visibleSlice.map((item) => {
                      if (item.type === 'group') {
                        const isGroupCollapsed = collapsedGroups.has(item.key);
                        return (
                          <div
                            key={item.key}
                            onClick={() => toggleGroup(item.key)}
                            className="flex h-[28px] cursor-pointer items-center border-b border-white/5 bg-white/[0.03] px-2 text-gray-400 transition-colors hover:bg-white/[0.06]"
                          >
                            <Icons.ChevronDown
                              className={`w-3 h-3 mr-2 transition-transform text-gray-500 ${isGroupCollapsed ? '-rotate-90' : ''}`}
                            />
                            <span className="font-semibold tracking-wide uppercase text-[9px]">
                              {item.groupName}
                            </span>
                          </div>
                        );
                      } else {
                        const prop = item.property;
                        const isSelected = selectedProperty === prop.path;
                        const isSummaryPath = prop.name === 'Path Animation';

                        return (
                          <div
                            key={prop.path}
                            className={`flex h-[28px] cursor-pointer items-center justify-between border-b border-white/5 px-4 transition-colors ${
                              isSelected
                                ? 'border-l-2 border-l-primary-500 bg-primary-900/15 text-primary-100'
                                : 'border-l-2 border-l-transparent text-gray-400 hover:bg-white/[0.04]'
                            }`}
                            onClick={() => setSelectedProperty(prop.path)}
                          >
                            <span
                              className={`truncate flex-1 text-[11px] font-medium ${isSummaryPath ? 'text-white' : ''}`}
                            >
                              {prop.name}
                            </span>
                            <div className="flex items-center gap-2 group">
                              {!isSummaryPath && (
                                <span
                                  className="font-mono text-[10px] text-gray-500 group-hover:text-white cursor-ew-resize w-10 text-right transition-colors"
                                  onMouseDown={(e) => {
                                    e.stopPropagation();
                                    const startX = e.clientX;
                                    const startVal = getValueAtFrame(prop.prop, currentFrame);
                                    let latestValue = startVal;
                                    const handleMove = (ev: MouseEvent) => {
                                      const dx = ev.clientX - startX;
                                      latestValue = startVal + dx * 0.1;
                                      setKeyframe(selectedNodeId!, prop.path, latestValue, false);
                                    };
                                    const handleUp = () => {
                                      setKeyframe(selectedNodeId!, prop.path, latestValue, true);
                                      window.removeEventListener('mousemove', handleMove);
                                      window.removeEventListener('mouseup', handleUp);
                                    };
                                    window.addEventListener('mousemove', handleMove);
                                    window.addEventListener('mouseup', handleUp);
                                  }}
                                >
                                  {getValueAtFrame(prop.prop, currentFrame).toFixed(1)}
                                </span>
                              )}
                              <button
                                className="text-gray-600 hover:text-primary-400 transition-colors opacity-0 group-hover:opacity-100"
                                title={isSummaryPath ? 'Add Keyframe to Shape' : 'Add Keyframe'}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // For Master Property, value doesn't matter (logic handles syncing)
                                  const val = isSummaryPath ? 0 : undefined;
                                  setKeyframe(selectedNodeId!, prop.path, val, true);
                                }}
                              >
                                <div
                                  className={`w-2 h-2 transform rotate-45 border border-current bg-transparent hover:bg-current ${isSummaryPath ? 'border-primary-400' : ''}`}
                                />
                              </button>
                            </div>
                          </div>
                        );
                      }
                    })}
                  </div>
                </div>
              )}
            </ScrollArea>

            {/* TIMELINE CONTENT */}
            <ScrollArea
              ref={timelineRef}
              rootClassName="flex-1 min-h-0"
              className="relative h-full overflow-auto bg-gradient-to-b from-gray-950/70 to-black/40"
              onScroll={handleScroll}
              onWheel={handleWheel}
              onMouseDown={handlePanDrag}
            >
              {/* Content Wrapper to ensure height matches sidebar */}
              <div
                ref={contentRef}
                className="relative"
                style={{
                  height: totalHeight,
                  width: '100%',
                  minWidth: timelineWidth,
                }}
                onMouseDown={handleContentMouseDown}
              >
                {viewMode === 'dopesheet' ? (
                  <>
                    {marqueeRect && (
                      <div
                        className="absolute border border-primary-400/60 bg-primary-500/10 pointer-events-none z-40"
                        style={{
                          left: marqueeRect.x,
                          top: marqueeRect.y,
                          width: marqueeRect.width,
                          height: marqueeRect.height,
                        }}
                      />
                    )}
                    {/* Playhead Line */}
                    <div
                      className="absolute top-0 bottom-0 w-px pointer-events-none z-30"
                      style={{
                        left: (currentFrame - timelineStartFrame) * zoom + panX,
                        backgroundColor: PLAYHEAD_COLOR,
                        boxShadow: '0 0 4px rgba(var(--color-primary-500), 0.5)',
                      }}
                    />

                    <div
                      className="absolute inset-x-0"
                      style={{ transform: `translateY(${sliceOffsetY}px)` }}
                    >
                      {visibleSlice.map((item, i) => {
                        const rowIndex = startRow + i;
                        return (
                          <div key={item.key} style={{ height: TRACK_HEIGHT }}>
                            {item.type === 'property' ? (
                              <DopeSheetTrack
                                prop={item.property.prop}
                                zoom={zoom}
                                panX={panX}
                                width={timelineWidth}
                                nodeId={selectedNodeId!}
                                path={item.property.path}
                                timelineStartFrame={timelineStartFrame}
                                maxFrames={maxFrames}
                                setSelectedKeyframes={setSelectedKeyframes}
                                onKeyframeMouseDown={(e, frame) =>
                                  handleKeyframeMouseDown(e, {
                                    nodeId: selectedNodeId!,
                                    path: item.property.path,
                                    frame,
                                  })
                                }
                                isKeyframeSelected={(frame) =>
                                  isKeyframeSelected(item.property.path, frame)
                                }
                                updateKeyframe={updateKeyframe}
                                onAddKeyframe={(f, v) =>
                                  setKeyframe(selectedNodeId!, item.property.path, v, true, f, true)
                                }
                                isEven={rowIndex % 2 === 0}
                                trackingData={item.property.trackingData}
                              />
                            ) : (
                              <div className="w-full h-full border-b border-white/5 bg-gray-800/30" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  // Graph View
                  <div className="sticky top-0 h-full w-full">
                    <GraphEditor
                      width={timelineWidth}
                      height={Math.max(height - EditorTimelineHeight.DEFAULT - RULER_HEIGHT, 200)}
                      view={{ panX, panY, zoomX: zoom, zoomY }}
                      setView={(v) => {
                        let newState;
                        if (typeof v === 'function') {
                          newState = v({
                            panX,
                            panY,
                            zoomX: zoom,
                            zoomY,
                          });
                        } else {
                          newState = v;
                        }
                        // Sync the dopesheet animation refs with graph editor's
                        // internal smooth zoom animation
                        timelineSnapTo({ zoom: newState.zoomX, panX: newState.panX });
                        setPanY(newState.panY);
                        setZoomY(newState.zoomY);
                      }}
                      activePropertyPath={selectedProperty}
                    />
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  );
}

export default Timeline;
