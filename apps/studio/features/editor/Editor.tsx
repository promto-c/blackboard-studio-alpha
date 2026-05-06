import React, { useRef, useState, useEffect } from 'react';
import useDeviceLayout, { LayoutMode } from '@/hooks/useDeviceLayout';
import { useEditorSelector } from '@/state/editorContext';
import { usePreferences } from '@/state/preferencesContext';
import {
  EDITOR_PANEL_WIDTH_DEFAULT,
  EDITOR_PANEL_WIDTH_MAX,
  EDITOR_PANEL_WIDTH_MIN,
  EDITOR_TIMELINE_HEIGHT_DEFAULT,
  EDITOR_TIMELINE_HEIGHT_MAX,
  EDITOR_TIMELINE_HEIGHT_MIN,
  clampEditorPanelWidth,
  clampEditorTimelineHeight,
} from '@/utils/editorLayout';
import { SplitterHandle } from '@blackboard/ui';
import Viewport from '@/features/viewport/Viewport';
import Panel from './Panel';
import Timeline from '@/features/timeline/Timeline';
import ViewportToolbar from '@/features/viewport/ViewportToolbar';
import Header from './Header';

const CORNER_HANDLE_PROXIMITY_PX = 56;

const Editor: React.FC = () => {
  const maxFrames = useEditorSelector((s) => s.maxFrames);
  const layoutMode = useDeviceLayout();
  const isMobilePortrait = layoutMode === LayoutMode.MobilePortrait;
  const { editorPanelWidth, editorTimelineHeight, setPreferences } = usePreferences();

  const [panelWidth, setPanelWidth] = useState(() => clampEditorPanelWidth(editorPanelWidth));
  const [timelineHeight, setTimelineHeight] = useState(() =>
    clampEditorTimelineHeight(editorTimelineHeight),
  );
  const [isCornerHandleHovered, setIsCornerHandleHovered] = useState(false);
  const [isCornerHandleDragging, setIsCornerHandleDragging] = useState(false);
  const [cornerHandleProximity, setCornerHandleProximity] = useState(0);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  const isTimelineVisible = maxFrames > 0;

  useEffect(() => {
    const nextPanelWidth = clampEditorPanelWidth(editorPanelWidth);
    setPanelWidth((current) => (current === nextPanelWidth ? current : nextPanelWidth));
  }, [editorPanelWidth]);

  useEffect(() => {
    const nextTimelineHeight = clampEditorTimelineHeight(editorTimelineHeight);
    setTimelineHeight((current) => (current === nextTimelineHeight ? current : nextTimelineHeight));
  }, [editorTimelineHeight]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const nextPrefs: Partial<{
        editorPanelWidth: number;
        editorTimelineHeight: number;
      }> = {};
      const nextPanelWidth = clampEditorPanelWidth(panelWidth);
      const nextTimelineHeight = clampEditorTimelineHeight(timelineHeight);

      if (nextPanelWidth !== editorPanelWidth) {
        nextPrefs.editorPanelWidth = nextPanelWidth;
      }
      if (nextTimelineHeight !== editorTimelineHeight) {
        nextPrefs.editorTimelineHeight = nextTimelineHeight;
      }

      if (Object.keys(nextPrefs).length > 0) {
        setPreferences(nextPrefs);
      }
    }, 150);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [editorPanelWidth, editorTimelineHeight, panelWidth, setPreferences, timelineHeight]);

  useEffect(() => {
    const el = editorContainerRef.current;
    if (el) {
      el.style.setProperty('--panel-width', `${isMobilePortrait ? 0 : panelWidth}px`);
      el.style.setProperty('--bottom-tray-height', '0px');
      el.style.setProperty('--timeline-height', `${isTimelineVisible ? timelineHeight : 0}px`);
      window.dispatchEvent(new CustomEvent('studio-editor-layout-resize'));
    }
  }, [panelWidth, isMobilePortrait, timelineHeight, isTimelineVisible]);

  useEffect(() => {
    if (isMobilePortrait || !isTimelineVisible || isCornerHandleDragging) {
      if (!isCornerHandleDragging) {
        setCornerHandleProximity(0);
      }
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const cornerX = panelWidth;
      const cornerY = window.innerHeight - timelineHeight;
      const distance = Math.hypot(event.clientX - cornerX, event.clientY - cornerY);
      const proximity = Math.max(0, 1 - distance / CORNER_HANDLE_PROXIMITY_PX);
      setCornerHandleProximity(proximity);
    };

    const handleMouseLeave = () => {
      setCornerHandleProximity(0);
    };

    window.addEventListener('pointermove', handlePointerMove);
    document.documentElement.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      document.documentElement.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [isCornerHandleDragging, isMobilePortrait, isTimelineVisible, panelWidth, timelineHeight]);

  const handleCornerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isMobilePortrait || !isTimelineVisible) return;

    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const startPanelWidth = panelWidth;
    const startTimelineHeight = timelineHeight;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
    setIsCornerHandleDragging(true);
    setCornerHandleProximity(1);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      setPanelWidth(
        Math.min(EDITOR_PANEL_WIDTH_MAX, Math.max(EDITOR_PANEL_WIDTH_MIN, startPanelWidth + dx)),
      );
      setTimelineHeight(
        Math.min(
          EDITOR_TIMELINE_HEIGHT_MAX,
          Math.max(EDITOR_TIMELINE_HEIGHT_MIN, startTimelineHeight - dy),
        ),
      );
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setIsCornerHandleDragging(false);
    };

    const handlePointerUp = () => {
      cleanup();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  const cornerHandleStrength = isCornerHandleDragging
    ? 1
    : Math.max(isCornerHandleHovered ? 1 : 0, cornerHandleProximity);
  const showCornerHandle = cornerHandleStrength > 0;
  const cornerHandleOpacity = showCornerHandle ? 0.16 + cornerHandleStrength * 0.84 : 0;
  const cornerHandleScale = 0.78 + cornerHandleStrength * 0.22;
  const cornerArmLength = 18 + cornerHandleStrength * 14;
  const cornerArmThickness = 4 + cornerHandleStrength * 2;
  const cornerCoreSize = 10 + cornerHandleStrength * 4;
  const cornerGlowOpacity = 0.08 + cornerHandleStrength * 0.18;
  const cornerHighlightOpacity = 0.14 + cornerHandleStrength * 0.18;

  return (
    <div
      ref={editorContainerRef}
      className="relative h-screen w-screen overflow-hidden bg-gray-900 font-sans"
    >
      {/* Viewport as fullscreen background */}
      <div className="absolute inset-0 z-0">
        <Viewport />
      </div>

      <Header />

      {/* UI node on top */}
      <div className="relative z-10 flex flex-col h-full w-full pointer-events-none">
        <main className={`flex flex-1 overflow-hidden ${isMobilePortrait ? 'flex-col' : ''}`}>
          {!isMobilePortrait && (
            <>
              <div
                style={{ width: `${panelWidth}px` }}
                className="h-full flex-shrink-0 pointer-events-auto"
              >
                <Panel isMobilePortrait={isMobilePortrait} />
              </div>
              <SplitterHandle
                axis="x"
                label="Panel"
                title="Resize panel"
                value={panelWidth}
                min={EDITOR_PANEL_WIDTH_MIN}
                max={EDITOR_PANEL_WIDTH_MAX}
                defaultValue={EDITOR_PANEL_WIDTH_DEFAULT}
                onChange={setPanelWidth}
                hideHandleAfterRatio={0.88}
              />
            </>
          )}
          <div className="flex-1 flex items-center justify-center overflow-hidden min-h-0 relative">
            {/* This is now a spacer, content is in the background Viewport */}
            <ViewportToolbar />
          </div>

          {isMobilePortrait && (
            <div className="pointer-events-auto">
              <Panel isMobilePortrait={isMobilePortrait} />
            </div>
          )}
        </main>
        <div className="pointer-events-auto flex flex-col">
          {isTimelineVisible && (
            <>
              {!isMobilePortrait && (
                <div
                  className="pointer-events-none absolute z-30"
                  style={{
                    left: panelWidth,
                    bottom: timelineHeight,
                    transform: 'translate(-50%, 50%)',
                  }}
                >
                  <div
                    role="separator"
                    aria-label="Resize panel and timeline"
                    title="Resize panel and timeline"
                    onPointerDown={handleCornerPointerDown}
                    onPointerEnter={() => setIsCornerHandleHovered(true)}
                    onPointerLeave={() => setIsCornerHandleHovered(false)}
                    className="pointer-events-auto relative flex h-11 w-11 items-center justify-center cursor-nwse-resize touch-none select-none outline-none transition-[opacity,transform] duration-200"
                    style={{
                      opacity: cornerHandleOpacity,
                      transform: `scale(${cornerHandleScale})`,
                    }}
                  >
                    <div
                      className="pointer-events-none absolute inset-0 flex items-center justify-center blur-md"
                      style={{ opacity: cornerGlowOpacity }}
                    >
                      <div
                        className="absolute rounded-full bg-primary-200/30"
                        style={{
                          width: cornerArmLength + 6,
                          height: cornerArmThickness + 6,
                        }}
                      />
                      <div
                        className="absolute rounded-full bg-primary-200/30"
                        style={{
                          width: cornerArmThickness + 6,
                          height: cornerArmLength + 6,
                        }}
                      />
                      <div
                        className="absolute rounded-full bg-primary-100/35"
                        style={{
                          width: cornerCoreSize + 8,
                          height: cornerCoreSize + 8,
                        }}
                      />
                    </div>
                    <div
                      className="pointer-events-none absolute inset-0 flex items-center justify-center"
                      style={{
                        filter:
                          'drop-shadow(0 0 0.5px rgba(255,255,255,0.18)) drop-shadow(0 10px 24px rgba(0,0,0,0.28))',
                      }}
                    >
                      <div
                        className="absolute rounded-full bg-black/60"
                        style={{ width: cornerArmLength, height: cornerArmThickness }}
                      />
                      <div
                        className="absolute rounded-full bg-black/60"
                        style={{ width: cornerArmThickness, height: cornerArmLength }}
                      />
                      <div
                        className="absolute rounded-full bg-black/72"
                        style={{ width: cornerCoreSize, height: cornerCoreSize }}
                      />
                      <div
                        className="absolute rounded-full bg-white/12"
                        style={{
                          width: Math.max(cornerArmLength - 8, 8),
                          height: 1.5,
                          opacity: cornerHighlightOpacity,
                          transform: 'translateY(-1px)',
                        }}
                      />
                      <div
                        className="absolute rounded-full bg-white/12"
                        style={{
                          width: 1.5,
                          height: Math.max(cornerArmLength - 8, 8),
                          opacity: cornerHighlightOpacity,
                          transform: 'translateX(-1px)',
                        }}
                      />
                    </div>
                    <div
                      className="pointer-events-none absolute flex items-center gap-0.5"
                      style={{ opacity: 0.46 + cornerHandleStrength * 0.26 }}
                    >
                      <div className="h-1 w-1 rounded-full bg-gray-100" />
                      <div className="h-1 w-1 rounded-full bg-gray-100" />
                      <div className="h-1 w-1 rounded-full bg-gray-100" />
                    </div>
                  </div>
                </div>
              )}
              <SplitterHandle
                axis="y"
                label="Timeline"
                title="Resize timeline"
                value={timelineHeight}
                min={EDITOR_TIMELINE_HEIGHT_MIN}
                max={EDITOR_TIMELINE_HEIGHT_MAX}
                defaultValue={EDITOR_TIMELINE_HEIGHT_DEFAULT}
                direction={-1}
                onChange={setTimelineHeight}
                hideHandleBeforeRatio={0.12}
              />
              <Timeline
                height={timelineHeight}
                setHeight={setTimelineHeight}
                minHeight={EDITOR_TIMELINE_HEIGHT_MIN}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Editor;
