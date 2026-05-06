import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { useSelectedEditorNode } from '@/hooks/useEditorNodes';
import { ViewerSettings, ViewerSlot } from '@blackboard/types';
import { Slider, Popover, HotkeyBadge } from '@/components';
import * as Icons from '@blackboard/icons';
import { useOcio } from '@/state/ocioContext';
import { nodeFlags } from '@/effects/effectHelpers';
import { OUTPUT_NODE_ID } from '@/state/editor/flowModel';
import { isMergeNodeId } from '@/utils/mergeNodes';
import { getViewerTargetLabel, VIEWER_SLOT_ORDER } from '@/utils/viewerSlots';

type SettingsBarLayout = 'full' | 'comfortable' | 'compact' | 'narrow';

const getSettingsBarLayout = (width: number): SettingsBarLayout => {
  if (width >= 720) return 'full';
  if (width >= 560) return 'comfortable';
  if (width >= 420) return 'compact';
  return 'narrow';
};

const menuButtonClass =
  'w-full flex items-center justify-between gap-3 text-left text-sm px-3 py-1.5 rounded-lg transition-all duration-150 text-gray-300 hover:bg-white/10';

const activeMenuButtonClass = 'bg-primary-500/30 text-white ring-1 ring-inset ring-primary-400/50';

// --- Main Component ---
const ViewportSettingsBar: React.FC = () => {
  const nodes = useEditorSelector((s) => s.nodes);
  const selectedNodeId = useEditorSelector((s) => s.selectedNodeId);
  const viewerSlots = useEditorSelector((s) => s.viewerSlots);
  const activeViewerSlot = useEditorSelector((s) => s.activeViewerSlot);
  const viewerSettings = useEditorSelector((s) => s.viewerSettings);
  const selectedNode = useSelectedEditorNode();
  const {
    setViewerSettings,
    toggleExposureDefault,
    assignViewerSlot,
    activateViewerSlot,
    clearViewerSlot,
  } = useEditorActions();
  const ocio = useOcio();
  const barRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const [isBarVisible, setIsBarVisible] = useState(true);
  const [openPopoverId, setOpenPopoverId] = useState<string | null>(null);
  const [availableWidth, setAvailableWidth] = useState(720);
  const [topRightControlsWidth, setTopRightControlsWidth] = useState(0);

  const availableViews = useMemo(() => {
    if (!ocio.isInitialized) return [];
    return ocio.views;
  }, [ocio]);

  useEffect(() => {
    const updateAvailableWidth = () => {
      const parentElement = barRef.current?.parentElement;
      setAvailableWidth(parentElement?.getBoundingClientRect().width ?? window.innerWidth);
      setTopRightControlsWidth(
        parentElement
          ? Number.parseFloat(
              getComputedStyle(parentElement).getPropertyValue('--top-right-controls-width'),
            ) || 0
          : 0,
      );
    };

    updateAvailableWidth();

    const parentElement = barRef.current?.parentElement;
    const observer =
      parentElement && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(updateAvailableWidth)
        : null;

    if (parentElement) {
      observer?.observe(parentElement);
    }

    window.addEventListener('resize', updateAvailableWidth);
    window.addEventListener('studio-top-right-controls-resize', updateAvailableWidth);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateAvailableWidth);
      window.removeEventListener('studio-top-right-controls-resize', updateAvailableWidth);
    };
  }, []);

  useEffect(() => {
    // When available views change, if the current view is not valid, reset it.
    if (availableViews.length > 0 && !availableViews.includes(viewerSettings.ocioView)) {
      setViewerSettings({ ocioView: availableViews[0] });
    }
  }, [availableViews, viewerSettings.ocioView, setViewerSettings]);

  useEffect(() => {
    const element = glowRef.current;
    if (!element) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = element.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      element.style.setProperty('--glow-x', `${x}px`);
      element.style.setProperty('--glow-y', `${y}px`);
    };

    const handleMouseEnter = () => {
      element.style.setProperty('--glow-opacity', '1');
      element.style.setProperty('--glow-scale', '1');
    };

    const handleMouseLeave = () => {
      element.style.setProperty('--glow-opacity', '0');
      element.style.setProperty('--glow-scale', '0');
    };

    element.addEventListener('mousemove', handleMouseMove);
    element.addEventListener('mouseenter', handleMouseEnter);
    element.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      if (element) {
        element.removeEventListener('mousemove', handleMouseMove);
        element.removeEventListener('mouseenter', handleMouseEnter);
        element.removeEventListener('mouseleave', handleMouseLeave);
      }
    };
  }, []);

  const handleToggleBar = () => {
    setIsBarVisible(!isBarVisible);
    if (isBarVisible) {
      setOpenPopoverId(null);
    }
  };

  const handlePopoverOpenChange = (id: string, open: boolean) => {
    if (open) {
      setOpenPopoverId(id);
    } else {
      if (openPopoverId === id) {
        setOpenPopoverId(null);
      }
    }
  };

  const handleSettingChange = <K extends keyof ViewerSettings>(
    key: K,
    value: ViewerSettings[K],
  ) => {
    setViewerSettings({ [key]: value });
  };

  const stopViewportToolStart = (event: React.MouseEvent | React.TouchEvent) => {
    event.stopPropagation();
  };

  const channels: ViewerSettings['channels'][] = ['RGB', 'R', 'G', 'B', 'A'];
  const isExposureCustom =
    viewerSettings.gain !== 1 || viewerSettings.gamma !== 1 || viewerSettings.saturation !== 1;
  const isOverlayVisible = viewerSettings.showOverlays;
  const isAlphaOverlayEnabled = viewerSettings.alphaOverlay;
  const isAlphaOverlayActive = isAlphaOverlayEnabled && viewerSettings.channels !== 'A';

  const selectedViewerTargetId = useMemo(() => {
    if (!selectedNodeId) return null;
    if (selectedNode) {
      return nodeFlags(selectedNode.type).isSceneLike ? null : selectedNode.id;
    }

    if (selectedNodeId === OUTPUT_NODE_ID || isMergeNodeId(selectedNodeId)) {
      return selectedNodeId;
    }

    return null;
  }, [selectedNode, selectedNodeId]);

  const layoutWidth = Math.max(0, availableWidth - (topRightControlsWidth + 16) * 2);
  const layout = getSettingsBarLayout(layoutWidth);
  const showAlphaInline = layout === 'full' || layout === 'comfortable';
  const showOverlayInline = layout !== 'narrow';
  const showOcioInline = ocio.isInitialized && (layout === 'full' || layout === 'comfortable');
  const showExposureInline = layout === 'full';
  const showViewerLabel = layout === 'full' || layout === 'comfortable';
  const showMoreButton =
    !showAlphaInline ||
    !showOverlayInline ||
    (ocio.isInitialized && !showOcioInline) ||
    !showExposureInline;
  const barMaxWidth = Math.max(224, layoutWidth);

  const handleViewerSlotClick = (slot: ViewerSlot, event: React.MouseEvent) => {
    if ((event.metaKey || event.ctrlKey) && selectedViewerTargetId) {
      assignViewerSlot(slot, selectedViewerTargetId);
      return;
    }

    if (event.altKey) {
      clearViewerSlot(slot);
      return;
    }

    activateViewerSlot(slot);
  };

  return (
    <div
      ref={barRef}
      className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center animate-[fadeIn_150ms_ease-out] pointer-events-auto"
      onMouseDown={stopViewportToolStart}
      onTouchStart={stopViewportToolStart}
    >
      <div
        ref={glowRef}
        style={{ maxWidth: barMaxWidth }}
        className={`interactive-glow glass-component relative z-10 flex min-w-0 items-center gap-2 bg-gray-900/50 backdrop-blur-xl border border-white/10 rounded-full shadow-lg ring-1 ring-inset ring-white/20 transition-all duration-300 overflow-hidden max-w-[calc(100vw-2rem)] ${
          isBarVisible ? 'max-h-20 px-2 py-1.5' : 'max-h-0 p-0 border-0 opacity-50'
        }`}
      >
        {/* Channels Button */}
        <Popover
          isOpen={openPopoverId === 'channels'}
          onOpenChange={(open) => handlePopoverOpenChange('channels', open)}
          trigger={
            <button
              onClick={() => {
                if (!isBarVisible) setIsBarVisible(true);
              }}
              title={`Channels: ${viewerSettings.channels}${isAlphaOverlayEnabled ? ' + alpha overlay' : ''}${isAlphaOverlayEnabled && !isAlphaOverlayActive ? ' (inactive in A)' : ''} (A / Shift+A)`}
              className={`p-1.5 rounded-full transition-colors data-[state=open]:bg-white/20 ${
                isAlphaOverlayEnabled
                  ? 'bg-primary-500/20 text-white ring-1 ring-inset ring-primary-400/40 hover:bg-primary-500/30'
                  : 'bg-transparent text-gray-300 hover:bg-white/10'
              }`}
            >
              <Icons.Channels channel={viewerSettings.channels} className="h-5 w-5" />
            </button>
          }
        >
          {(close) => (
            <div className="space-y-1">
              {channels.map((ch) => (
                <button
                  key={ch}
                  onClick={() => {
                    handleSettingChange('channels', ch);
                    close();
                  }}
                  className={`w-full text-left text-sm px-3 py-1.5 rounded-lg transition-all duration-150 ${viewerSettings.channels === ch ? 'bg-primary-500/30 text-white ring-1 ring-inset ring-primary-400/50' : 'text-gray-300 hover:bg-white/10'}`}
                >
                  {ch}
                </button>
              ))}
              <div className="h-px bg-white/10 my-1" />
              <button
                onClick={() => {
                  handleSettingChange('alphaOverlay', !viewerSettings.alphaOverlay);
                  close();
                }}
                className={`w-full text-left text-sm px-3 py-1.5 rounded-lg transition-all duration-150 ${isAlphaOverlayEnabled ? 'bg-primary-500/30 text-white ring-1 ring-inset ring-primary-400/50' : 'text-gray-300 hover:bg-white/10'}`}
              >
                <span className="inline-flex items-center gap-2">
                  <span>Alpha Overlay</span>
                  <HotkeyBadge combo="Shift+A" />
                </span>
              </button>
            </div>
          )}
        </Popover>

        {/* Alpha Mode Button */}
        {showAlphaInline && (
          <Popover
            isOpen={openPopoverId === 'alpha'}
            onOpenChange={(open) => handlePopoverOpenChange('alpha', open)}
            trigger={
              <button
                onClick={() => {
                  if (!isBarVisible) setIsBarVisible(true);
                }}
                title={`Alpha Mode: ${viewerSettings.alphaMode.replace('_', ' ')}`}
                className="p-1.5 rounded-full transition-colors bg-transparent text-gray-300 hover:bg-white/10 data-[state=open]:bg-white/20"
              >
                <Icons.Alpha className="h-5 w-5" />
              </button>
            }
          >
            {(close) => (
              <div className="space-y-1">
                {(['STRAIGHT', 'TRANSPARENT', 'FILL_BLACK', 'FILL_WHITE'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => {
                      handleSettingChange('alphaMode', mode);
                      close();
                    }}
                    className={`w-full text-left text-sm px-3 py-1.5 rounded-lg capitalize transition-all duration-150 ${viewerSettings.alphaMode === mode ? 'bg-primary-500/30 text-white ring-1 ring-inset ring-primary-400/50' : 'text-gray-300 hover:bg-white/10'}`}
                  >
                    {mode.replace('_', ' ').toLowerCase()}
                  </button>
                ))}
              </div>
            )}
          </Popover>
        )}

        {/* Overlay Visibility Button */}
        {showOverlayInline && (
          <button
            onClick={() => {
              if (!isBarVisible) setIsBarVisible(true);
              handleSettingChange('showOverlays', !isOverlayVisible);
            }}
            title={`Overlays: ${isOverlayVisible ? 'On' : 'Off'} (0)`}
            className={`p-1.5 rounded-full transition-colors ${
              isOverlayVisible
                ? 'bg-primary-500/20 text-white ring-1 ring-inset ring-primary-400/40 hover:bg-primary-500/30'
                : 'bg-transparent text-gray-300 hover:bg-white/10'
            }`}
          >
            {isOverlayVisible ? (
              <Icons.OverlayOn className="h-5 w-5" />
            ) : (
              <Icons.OverlayOff className="h-5 w-5" />
            )}
          </button>
        )}

        <div className="flex min-w-0 shrink items-center gap-1 pl-1 pr-1.5 py-1 rounded-full bg-black/20 ring-1 ring-inset ring-white/10">
          {showViewerLabel && (
            <span className="text-[10px] uppercase tracking-wider text-gray-400 px-1">View</span>
          )}
          {VIEWER_SLOT_ORDER.map((slot) => {
            const assignedNodeId = viewerSlots?.[slot];
            const isAssigned = !!assignedNodeId;
            const isActive = activeViewerSlot === slot;
            const assignedNodeName = assignedNodeId
              ? getViewerTargetLabel(assignedNodeId, nodes)
              : 'Unassigned';

            return (
              <button
                key={`viewer-slot-${slot}`}
                onClick={(event) => handleViewerSlotClick(slot, event)}
                className={`w-6 h-6 rounded-full text-[11px] font-semibold transition-all ring-1 ring-inset ${
                  isActive
                    ? 'bg-primary-500/40 text-white ring-primary-300/80 shadow-[0_0_0_1px_rgba(99,102,241,0.35)]'
                    : isAssigned
                      ? 'bg-gray-700/90 text-gray-100 ring-gray-500/70 hover:bg-gray-600/90'
                      : 'bg-gray-800/80 text-gray-500 ring-gray-700 hover:text-gray-300 hover:ring-gray-500'
                }`}
                title={`Slot ${slot}: ${assignedNodeName}${isActive ? ' (active)' : ''}. Hotkeys: ${slot} recalls slot; in Flow view it assigns selected target. Ctrl/Cmd+${slot} recalls only.`}
              >
                {slot}
              </button>
            );
          })}
        </div>

        {/* OCIO View */}
        {showOcioInline && (
          <Popover
            isOpen={openPopoverId === 'ocioView'}
            onOpenChange={(open) => handlePopoverOpenChange('ocioView', open)}
            trigger={
              <button
                onClick={() => {
                  if (!isBarVisible) setIsBarVisible(true);
                }}
                title={`View: ${viewerSettings.ocioView}`}
                className="flex min-w-0 max-w-44 items-center gap-2 px-3 py-1 text-xs rounded-full transition-colors bg-transparent text-gray-300 hover:bg-white/10 data-[state=open]:bg-white/20 data-[state=open]:text-white"
              >
                <Icons.ComputerDesktop className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate font-mono">{viewerSettings.ocioView}</span>
              </button>
            }
          >
            {(close) => (
              <div className="space-y-1">
                {availableViews.map((view) => (
                  <button
                    key={view}
                    onClick={() => {
                      handleSettingChange('ocioView', view);
                      close();
                    }}
                    className={`w-full text-left text-sm px-3 py-1.5 rounded-lg transition-all duration-150 ${viewerSettings.ocioView === view ? 'bg-primary-500/30 text-white ring-1 ring-inset ring-primary-400/50' : 'text-gray-300 hover:bg-white/10'}`}
                  >
                    {view}
                  </button>
                ))}
              </div>
            )}
          </Popover>
        )}

        <div className="w-px h-5 bg-gray-700 mx-1"></div>

        {/* Exposure Button */}
        {showExposureInline && (
          <Popover
            widthClass="w-56"
            isOpen={openPopoverId === 'exposure'}
            onOpenChange={(open) => handlePopoverOpenChange('exposure', open)}
            trigger={
              <button
                onClick={() => {
                  if (!isBarVisible) setIsBarVisible(true);
                }}
                title="Adjust Exposure"
                className={`flex items-center gap-2 px-3 py-1 text-xs rounded-full transition-colors group ${
                  isExposureCustom
                    ? 'bg-primary-900/40 text-white ring-1 ring-inset ring-primary-500/50'
                    : 'bg-transparent text-gray-300 hover:bg-white/10'
                } data-[state=open]:bg-white/20 data-[state=open]:text-white`}
              >
                <Icons.Sun className="h-4 w-4" />
                <span
                  className={`font-mono transition-colors ${viewerSettings.gain !== 1 ? 'text-primary-300' : 'text-white'}`}
                >
                  {viewerSettings.gain.toFixed(1)}
                </span>
                <Icons.Gamma className="h-4 w-4" />
                <span
                  className={`font-mono transition-colors ${viewerSettings.gamma !== 1 ? 'text-primary-300' : 'text-white'}`}
                >
                  {viewerSettings.gamma.toFixed(1)}
                </span>
                <Icons.Saturation className="h-4 w-4" />
                <span
                  className={`font-mono transition-colors ${viewerSettings.saturation !== 1 ? 'text-primary-300' : 'text-white'}`}
                >
                  {viewerSettings.saturation.toFixed(1)}
                </span>
                <>
                  <div className="w-px h-4 bg-gray-600/50 group-hover:bg-gray-500 mx-1"></div>
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExposureDefault();
                    }}
                    title={
                      isExposureCustom ? 'Reset Exposure to Default' : 'Restore Custom Exposure'
                    }
                    className="-mr-2 p-1 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <Icons.Reset className="h-4 w-4" />
                  </div>
                </>
              </button>
            }
          >
            <div className="p-2 space-y-4">
              <Slider
                label="Gain"
                value={viewerSettings.gain}
                min={0}
                max={4}
                step={0.05}
                onChange={(v) => handleSettingChange('gain', v)}
                onReset={() => handleSettingChange('gain', 1)}
                displayFormatter={(v) => v.toFixed(2)}
              />
              <Slider
                label="Gamma"
                value={viewerSettings.gamma}
                min={0.01}
                max={4}
                step={0.01}
                onChange={(v) => handleSettingChange('gamma', v)}
                onReset={() => handleSettingChange('gamma', 1)}
                displayFormatter={(v) => v.toFixed(2)}
              />
              <Slider
                label="Saturation"
                value={viewerSettings.saturation}
                min={0}
                max={2}
                step={0.05}
                onChange={(v) => handleSettingChange('saturation', v)}
                onReset={() => handleSettingChange('saturation', 1)}
                displayFormatter={(v) => v.toFixed(2)}
              />
            </div>
          </Popover>
        )}

        {showMoreButton && (
          <Popover
            widthClass="w-64"
            align="end"
            isOpen={openPopoverId === 'more'}
            onOpenChange={(open) => handlePopoverOpenChange('more', open)}
            trigger={
              <button
                onClick={() => {
                  if (!isBarVisible) setIsBarVisible(true);
                }}
                title="More viewport settings"
                className="p-1.5 rounded-full transition-colors bg-transparent text-gray-300 hover:bg-white/10 data-[state=open]:bg-white/20 data-[state=open]:text-white"
              >
                <Icons.EllipsisVertical className="h-5 w-5" />
              </button>
            }
          >
            {(close) => (
              <div className="space-y-3">
                {!showAlphaInline && (
                  <div className="space-y-1">
                    <div className="px-3 text-[10px] uppercase tracking-wider text-gray-500">
                      Alpha Mode
                    </div>
                    {(['STRAIGHT', 'TRANSPARENT', 'FILL_BLACK', 'FILL_WHITE'] as const).map(
                      (mode) => (
                        <button
                          key={`more-alpha-${mode}`}
                          onClick={() => {
                            handleSettingChange('alphaMode', mode);
                            close();
                          }}
                          className={`${menuButtonClass} capitalize ${
                            viewerSettings.alphaMode === mode ? activeMenuButtonClass : ''
                          }`}
                        >
                          <span>{mode.replace('_', ' ').toLowerCase()}</span>
                          {viewerSettings.alphaMode === mode && <Icons.Check className="h-4 w-4" />}
                        </button>
                      ),
                    )}
                  </div>
                )}

                {!showOverlayInline && (
                  <div className="space-y-1">
                    <div className="px-3 text-[10px] uppercase tracking-wider text-gray-500">
                      Overlays
                    </div>
                    <button
                      onClick={() => {
                        handleSettingChange('showOverlays', !isOverlayVisible);
                        close();
                      }}
                      className={`${menuButtonClass} ${isOverlayVisible ? activeMenuButtonClass : ''}`}
                    >
                      <span className="inline-flex min-w-0 items-center gap-2">
                        {isOverlayVisible ? (
                          <Icons.OverlayOn className="h-4 w-4 shrink-0" />
                        ) : (
                          <Icons.OverlayOff className="h-4 w-4 shrink-0" />
                        )}
                        <span>Show Overlays</span>
                      </span>
                      {isOverlayVisible && <Icons.Check className="h-4 w-4 shrink-0" />}
                    </button>
                  </div>
                )}

                {ocio.isInitialized && !showOcioInline && (
                  <div className="space-y-1">
                    <div className="px-3 text-[10px] uppercase tracking-wider text-gray-500">
                      View Transform
                    </div>
                    <div className="max-h-48 overflow-y-auto pr-1">
                      {availableViews.map((view) => (
                        <button
                          key={`more-ocio-${view}`}
                          onClick={() => {
                            handleSettingChange('ocioView', view);
                            close();
                          }}
                          className={`${menuButtonClass} ${
                            viewerSettings.ocioView === view ? activeMenuButtonClass : ''
                          }`}
                          title={view}
                        >
                          <span className="min-w-0 truncate font-mono">{view}</span>
                          {viewerSettings.ocioView === view && (
                            <Icons.Check className="h-4 w-4 shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {!showExposureInline && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3 px-3">
                      <div className="text-[10px] uppercase tracking-wider text-gray-500">
                        Exposure
                      </div>
                      <button
                        onClick={toggleExposureDefault}
                        title={
                          isExposureCustom ? 'Reset Exposure to Default' : 'Restore Custom Exposure'
                        }
                        className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        <Icons.Reset className="h-3.5 w-3.5" />
                        <span>{isExposureCustom ? 'Reset' : 'Restore'}</span>
                      </button>
                    </div>
                    <div className="px-2 space-y-4">
                      <Slider
                        label="Gain"
                        value={viewerSettings.gain}
                        min={0}
                        max={4}
                        step={0.05}
                        onChange={(v) => handleSettingChange('gain', v)}
                        onReset={() => handleSettingChange('gain', 1)}
                        displayFormatter={(v) => v.toFixed(2)}
                      />
                      <Slider
                        label="Gamma"
                        value={viewerSettings.gamma}
                        min={0.01}
                        max={4}
                        step={0.01}
                        onChange={(v) => handleSettingChange('gamma', v)}
                        onReset={() => handleSettingChange('gamma', 1)}
                        displayFormatter={(v) => v.toFixed(2)}
                      />
                      <Slider
                        label="Saturation"
                        value={viewerSettings.saturation}
                        min={0}
                        max={2}
                        step={0.05}
                        onChange={(v) => handleSettingChange('saturation', v)}
                        onReset={() => handleSettingChange('saturation', 1)}
                        displayFormatter={(v) => v.toFixed(2)}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </Popover>
        )}
      </div>

      <button
        onClick={handleToggleBar}
        className="group w-12 h-5 mt-2 bg-gray-900/50 backdrop-blur-xl border border-white/10 rounded-full flex items-center justify-center shadow-lg ring-1 ring-inset ring-white/20 hover:border-white/20 transition-all duration-300 glass-component"
        aria-label={isBarVisible ? 'Hide settings bar' : 'Show settings bar'}
      >
        <Icons.ChevronDown
          className={`h-4 w-4 text-gray-400 transition-all duration-300 group-hover:text-white group-hover:scale-110 ${isBarVisible ? 'rotate-180' : 'rotate-0'}`}
        />
      </button>
    </div>
  );
};

export default ViewportSettingsBar;
