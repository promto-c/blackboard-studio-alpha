import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { useSceneNode, useSelectedEditorNode } from '@/hooks/useEditorNodes';
import type { ViewerSettings, ViewerSlot } from '@blackboard/types';
import { Popover, Slider } from '@blackboard/ui';
import { DisplayViewSelector, HotkeyBadge, ViewportToolButton } from '@/components';
import { useRegisterHotkeyCommands, useRegisterHotkeys } from '@/hotkeys';
import type { HotkeyBinding, HotkeyCommand } from '@/hotkeys';
import * as Icons from '@blackboard/icons';
import { nodeFlags } from '@/nodes/helpers';
import { OUTPUT_NODE_ID } from '@/state/editor/flowModel';
import {
  getViewerCompareSlotRole,
  getViewerTargetLabel,
  VIEWER_SLOT_ORDER,
} from '@/utils/viewerSlots';
import { hasViewerDisplayOverride, resolveCurrentViewerDisplayView } from '@/color-management';
import { ViewportCompareBar } from './ViewportCompareBar';
import {
  VIEWER_COMPARE_SLOT_CLASS,
  VIEWER_COMPARE_SLOT_LABEL,
} from '@/components/viewerSlotPresentation';
import { WorkingAreaSettings } from './WorkingAreaSettings';
import { VIEWPORT_WORKING_AREA_TOOL } from './workingArea';

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

function ViewportSettingsBar() {
  const nodes = useEditorSelector((s) => s.nodes);
  const selectedNodeId = useEditorSelector((s) => s.selectedNodeId);
  const viewerSlots = useEditorSelector((s) => s.viewerSlots);
  const activeViewerSlot = useEditorSelector((s) => s.activeViewerSlot);
  const compareView = useEditorSelector((s) => s.compareView);
  const viewerSettings = useEditorSelector((s) => s.viewerSettings);
  const activeViewportTool = useEditorSelector((s) => s.activeViewportTool);
  const viewportWorkingArea = useEditorSelector((s) => s.viewportWorkingArea);
  const projectDisplayView = useEditorSelector((s) => s.colorManagement.viewer);
  const viewerColorManagement = useEditorSelector((s) => s.viewerColorManagement);
  const currentViewerDisplayView = resolveCurrentViewerDisplayView(
    projectDisplayView,
    viewerColorManagement,
  );
  const selectedNode = useSelectedEditorNode();
  const sceneNode = useSceneNode();
  const {
    resetViewerToProjectView,
    setViewerDisplayView,
    setViewerSettings,
    toggleExposureDefault,
    assignViewerSlot,
    activateViewerSlot,
    clearViewerSlot,
    setActiveViewportTool,
    setViewportWorkingArea,
    setViewportWorkingAreaEnabled,
    resetViewportWorkingArea,
  } = useEditorActions();
  const barRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const [isBarVisible, setIsBarVisible] = useState(true);
  const [openPopoverId, setOpenPopoverId] = useState<string | null>(null);
  const [availableWidth, setAvailableWidth] = useState(720);
  const [topRightControlsWidth, setTopRightControlsWidth] = useState(0);
  const selectedOcioDisplay = currentViewerDisplayView.display;

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

  useEffect(() => {
    if (!compareView.isActive) return;
    setOpenPopoverId((current) => (current === 'workingArea' ? null : current));
  }, [compareView.isActive]);

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
  const isGamutWarningEnabled = viewerSettings.gamutWarning;

  const selectedViewerTargetId = useMemo(() => {
    if (!selectedNodeId) return null;
    if (selectedNode) {
      return nodeFlags(selectedNode.type).isSceneLike ? null : selectedNode.id;
    }

    if (selectedNodeId === OUTPUT_NODE_ID) {
      return selectedNodeId;
    }

    return null;
  }, [selectedNode, selectedNodeId]);

  const layoutWidth = Math.max(0, availableWidth - (topRightControlsWidth + 16) * 2);
  const layout = getSettingsBarLayout(layoutWidth);
  const showOverlayInline = layout !== 'narrow';
  const showOcioInline = layout === 'full' || layout === 'comfortable';
  const showExposureInline = layout === 'full';
  const showViewerLabel = layout === 'full' || layout === 'comfortable';
  const showMoreButton = !showOverlayInline || !showOcioInline || !showExposureInline;
  const barMaxWidth = Math.max(224, layoutWidth);

  const isCompareActive = compareView.isActive;
  const isWorkingAreaToolActive = activeViewportTool === VIEWPORT_WORKING_AREA_TOOL;

  const toggleWorkingAreaTool = useCallback(() => {
    if (!sceneNode || isCompareActive) return false;
    setActiveViewportTool(isWorkingAreaToolActive ? null : VIEWPORT_WORKING_AREA_TOOL);
    return true;
  }, [isCompareActive, isWorkingAreaToolActive, sceneNode, setActiveViewportTool]);

  const workingAreaCommands = useMemo<HotkeyCommand[]>(
    () => [
      {
        id: 'viewport.toggleWorkingArea.runtime',
        run: toggleWorkingAreaTool,
      },
    ],
    [toggleWorkingAreaTool],
  );

  const workingAreaBindings = useMemo<HotkeyBinding[]>(
    () =>
      sceneNode && !isCompareActive
        ? [
            {
              keys: 'Shift+R',
              command: 'viewport.toggleWorkingArea.runtime',
              scope: 'viewport',
              weight: 450,
            },
          ]
        : [],
    [isCompareActive, sceneNode],
  );

  useRegisterHotkeyCommands('viewport.settingsBar', workingAreaCommands);
  useRegisterHotkeys('viewport.settingsBar', workingAreaBindings);

  const handleViewerSlotClick = (slot: ViewerSlot, event: React.MouseEvent) => {
    // Slot activation owns the atomic Compare-to-single-view transition.
    if (isCompareActive) {
      activateViewerSlot(slot);
      return;
    }

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
        style={{ maxWidth: barMaxWidth, overflow: isBarVisible ? 'visible' : 'hidden' }}
        className={`interactive-glow glass-component relative z-10 flex min-w-0 items-center ${layout === 'narrow' ? 'gap-1' : 'gap-2'} bg-gray-900/50 backdrop-blur-xl border border-white/10 rounded-full shadow-lg ring-1 ring-inset ring-white/20 transition-all duration-300 max-w-[calc(100vw-2rem)] ${
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
              <button
                onClick={() => {
                  handleSettingChange('gamutWarning', !viewerSettings.gamutWarning);
                  close();
                }}
                className={`w-full px-3 py-1.5 text-left text-sm transition-all duration-150 ${
                  isGamutWarningEnabled
                    ? 'rounded-lg bg-primary-500/30 text-white ring-1 ring-inset ring-primary-400/50'
                    : 'rounded-lg text-gray-300 hover:bg-white/10'
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <Icons.ExclamationCircle className="h-4 w-4" />
                  <span>Output Gamut Warning</span>
                </span>
              </button>
            </div>
          )}
        </Popover>

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

        {/* Viewport-global Working Area tool */}
        {sceneNode && (
          <Popover
            widthClass="w-80 max-w-[calc(100vw-1rem)]"
            sideOffset={30}
            isOpen={openPopoverId === 'workingArea'}
            onOpenChange={(open) => handlePopoverOpenChange('workingArea', open)}
            trigger={
              <ViewportToolButton
                label="Working Area"
                disabled={isCompareActive}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleWorkingAreaTool();
                }}
                onSettingsClick={() => undefined}
                settingsPlacement="bottom"
                isActive={isWorkingAreaToolActive}
                isSettingsActive={openPopoverId === 'workingArea'}
                title={
                  isCompareActive
                    ? 'Working Area is unavailable while Compare is active'
                    : `Working Area: ${viewportWorkingArea.enabled ? 'Enabled' : 'Disabled'} (Shift+R toggles tool)`
                }
                aria-label="Working Area"
                icon={
                  <>
                    <Icons.Rectangle className="h-5 w-5" />
                    {viewportWorkingArea.enabled && (
                      <span
                        aria-hidden="true"
                        className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-teal-300 ring-1 ring-gray-900"
                      />
                    )}
                  </>
                }
              />
            }
          >
            <WorkingAreaSettings
              scene={sceneNode}
              workingArea={viewportWorkingArea}
              onChange={setViewportWorkingArea}
              onEnabledChange={setViewportWorkingAreaEnabled}
              onReset={resetViewportWorkingArea}
            />
          </Popover>
        )}

        <div
          className={`flex min-w-0 shrink items-center rounded-full bg-black/20 py-1 ring-1 ring-inset ring-white/10 ${
            layout === 'narrow' ? 'gap-0.5 pl-0.5 pr-1' : 'gap-1 pl-1 pr-1.5'
          }`}
        >
          {showViewerLabel && (
            <span className="text-[10px] uppercase tracking-wider text-gray-400 px-1">View</span>
          )}
          {VIEWER_SLOT_ORDER.map((slot) => {
            const assignedNodeId = viewerSlots?.[slot];
            const isAssigned = !!assignedNodeId;
            const isActive = activeViewerSlot === slot;
            const compareRole = isCompareActive
              ? getViewerCompareSlotRole(
                  slot,
                  compareView.slotA && compareView.slotB
                    ? [compareView.slotA, compareView.slotB]
                    : null,
                )
              : null;
            const isInCompare = compareRole !== null;
            const comparedWithLabel =
              isInCompare && compareView.slotA === slot
                ? ` vs slot ${compareView.slotB}`
                : isInCompare && compareView.slotB === slot
                  ? ` vs slot ${compareView.slotA}`
                  : '';
            const assignedNodeName = assignedNodeId
              ? getViewerTargetLabel(assignedNodeId, nodes)
              : 'Unassigned';
            const slotClassName = compareRole
              ? VIEWER_COMPARE_SLOT_CLASS[compareRole]
              : isActive
                ? 'bg-primary-500/40 text-white ring-primary-300/80 shadow-[0_0_0_1px_rgba(99,102,241,0.35)]'
                : isAssigned
                  ? 'bg-gray-700/90 text-gray-100 ring-gray-500/70 hover:bg-gray-600/90'
                  : 'bg-gray-800/80 text-gray-500 ring-gray-700 hover:text-gray-300 hover:ring-gray-500';

            return (
              <button
                key={`viewer-slot-${slot}`}
                onClick={(event) => handleViewerSlotClick(slot, event)}
                className={`w-6 h-6 rounded-full text-[11px] font-semibold transition-all ring-1 ring-inset ${slotClassName}`}
                title={`Slot ${slot}: ${assignedNodeName}${isActive ? ' (active)' : ''}${compareRole ? ` (${VIEWER_COMPARE_SLOT_LABEL[compareRole]}${comparedWithLabel}, click to exit compare)` : ''}. Hotkeys: ${slot} toggles slot; Ctrl/Cmd+${slot} assigns selected target.`}
              >
                {slot}
              </button>
            );
          })}
        </div>

        {/* OCIO Display/View */}
        {showOcioInline && (
          <Popover
            widthClass="w-80"
            isOpen={openPopoverId === 'displayView'}
            onOpenChange={(open) => handlePopoverOpenChange('displayView', open)}
            trigger={
              <button
                onClick={() => {
                  if (!isBarVisible) setIsBarVisible(true);
                }}
                title={`Current Viewer: ${selectedOcioDisplay} / ${currentViewerDisplayView.view}`}
                className="flex min-w-0 max-w-44 items-center gap-2 px-3 py-1 text-xs rounded-full transition-colors bg-transparent text-gray-300 hover:bg-white/10 data-[state=open]:bg-white/20 data-[state=open]:text-white"
              >
                <Icons.ComputerDesktop className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate font-mono">{currentViewerDisplayView.view}</span>
              </button>
            }
          >
            {(close) => (
              <div className="space-y-3">
                <DisplayViewSelector
                  value={currentViewerDisplayView}
                  onChange={setViewerDisplayView}
                  variant="inline-list"
                />
                {hasViewerDisplayOverride(viewerColorManagement) ? (
                  <button
                    type="button"
                    onClick={() => {
                      resetViewerToProjectView();
                      close();
                    }}
                    className={menuButtonClass}
                  >
                    <span>Reset to Project View</span>
                    <Icons.Reset className="h-4 w-4 shrink-0" />
                  </button>
                ) : null}
              </div>
            )}
          </Popover>
        )}

        {layout !== 'narrow' && <div className="w-px h-5 bg-gray-700 mx-1" />}

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

                {!showOcioInline && (
                  <div className="space-y-3">
                    <DisplayViewSelector
                      value={currentViewerDisplayView}
                      onChange={setViewerDisplayView}
                      variant="inline-list"
                    />
                    {hasViewerDisplayOverride(viewerColorManagement) ? (
                      <button
                        type="button"
                        onClick={() => {
                          resetViewerToProjectView();
                          close();
                        }}
                        className={menuButtonClass}
                      >
                        <span>Reset to Project View</span>
                        <Icons.Reset className="h-4 w-4 shrink-0" />
                      </button>
                    ) : null}
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
                        className="inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-1 text-[11px] text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
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
      </div>{' '}
      {/* Compare mode controls — second row */}
      {isCompareActive && isBarVisible && (
        <div className="mt-2">
          <ViewportCompareBar embedded />
        </div>
      )}
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
}

export default ViewportSettingsBar;
