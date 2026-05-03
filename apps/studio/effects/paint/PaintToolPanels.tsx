import React, { useMemo } from 'react';
import type { AnyNode, PaintStrokePathsMode } from '@blackboard/types';
import { useEditorSelector } from '@/state/editorContext';
import { DEFAULT_PAINT_BRUSH_SETTINGS, usePreferences } from '@/state/preferencesContext';
import {
  ColorPicker,
  Slider,
  SegmentedControl,
  ViewportToolPanel as Panel,
  ViewportToolPanelHeader as PanelHeader,
} from '@/components';
import { mergePaintBrushSettings } from './softness';
import { resolvePaintBrushChannels } from './channels';

const DrawingToolsPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const activeViewportTool = useEditorSelector((state) => state.activeViewportTool);
  const viewerChannels = useEditorSelector((state) => state.viewerSettings.channels);
  const { paintBrush, setPreferences } = usePreferences();
  const panelTitle =
    activeViewportTool === 'erase' ? 'Erase' : activeViewportTool === 'clone' ? 'Clone' : 'Brush';
  const supportsChannelTargeting =
    activeViewportTool === 'brush' ||
    activeViewportTool === 'clone' ||
    activeViewportTool === 'erase';
  const supportsColor = activeViewportTool === 'brush';
  const channelOptions = useMemo(
    // TODO: Re-enable R/G/B once per-channel paint targeting is fully implemented end to end.
    () => [
      { value: 'view', label: 'As View' },
      { value: 'rgb', label: 'RGB' },
      { value: 'a', label: 'A' },
    ],
    [],
  );

  const updateBrush = (updates: Partial<typeof paintBrush>) => {
    setPreferences({ paintBrush: mergePaintBrushSettings(paintBrush, updates) });
  };
  const resolvedChannels = resolvePaintBrushChannels(paintBrush.channels, viewerChannels);

  return (
    <Panel width="w-80">
      <PanelHeader title={`${panelTitle} Settings`} onClose={onClose} />
      <div className="space-y-3">
        {supportsChannelTargeting ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[10px] font-medium uppercase tracking-[0.16em] text-gray-400">
                Affect
              </label>
              <span className="text-[10px] text-gray-500">
                {paintBrush.channels === 'view'
                  ? `New strokes follow View (${viewerChannels})`
                  : 'New strokes only'}
              </span>
            </div>
            <SegmentedControl
              options={channelOptions}
              value={paintBrush.channels}
              onChange={(value) => updateBrush({ channels: value as typeof paintBrush.channels })}
            />
          </div>
        ) : null}
        {supportsColor ? (
          <ColorPicker
            label={resolvedChannels === 'a' ? 'Value' : 'Color'}
            value={paintBrush.color}
            onChange={(value) => updateBrush({ color: value })}
            alpha={resolvedChannels === 'a' ? paintBrush.alpha : undefined}
            onAlphaChange={
              resolvedChannels === 'a' ? (value) => updateBrush({ alpha: value }) : undefined
            }
            alphaLabel="Alpha"
          />
        ) : null}
        <Slider
          label="Size"
          value={paintBrush.size}
          min={1}
          max={256}
          step={1}
          onChange={(value) => updateBrush({ size: value })}
          onReset={() => updateBrush({ size: DEFAULT_PAINT_BRUSH_SETTINGS.size })}
          displayFormatter={(value) => `${Math.round(value)}px`}
        />
        <Slider
          label="Softness"
          value={paintBrush.softness}
          min={0}
          max={100}
          step={1}
          onChange={(value) => updateBrush({ softness: value })}
          onReset={() => updateBrush({ softness: DEFAULT_PAINT_BRUSH_SETTINGS.softness })}
          displayFormatter={(value) => `${Math.round(value)}%`}
        />
        <Slider
          label="Opacity"
          value={paintBrush.opacity}
          min={1}
          max={100}
          step={1}
          onChange={(value) => updateBrush({ opacity: value })}
          onReset={() => updateBrush({ opacity: DEFAULT_PAINT_BRUSH_SETTINGS.opacity })}
          displayFormatter={(value) => `${Math.round(value)}%`}
        />
      </div>
    </Panel>
  );
};

const NudgePanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { nudgeRadius, setPreferences } = usePreferences();
  return (
    <Panel width="w-44">
      <PanelHeader title="Nudge" onClose={onClose} />
      <p className="text-[10px] text-gray-400 text-center mb-1">Ctrl/Cmd + Drag to resize</p>
      <p className="text-[10px] text-gray-400 text-center mb-2">Shift for uniform strength</p>
      <Slider
        label="Radius"
        value={nudgeRadius}
        min={1}
        max={500}
        step={1}
        onChange={(r) => setPreferences({ nudgeRadius: Math.max(1, Math.min(500, r)) })}
        onReset={() => setPreferences({ nudgeRadius: 50 })}
        displayFormatter={(v) => `${v.toFixed(0)}px`}
      />
    </Panel>
  );
};

const StrokePathsPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { paintStrokePathsVisible, paintStrokePathsMode, setPreferences } = usePreferences();

  const displayOptions = useMemo(
    () => [
      { value: 'all', label: 'All Strokes' },
      { value: 'selected_layer', label: 'Active Layer' },
    ],
    [],
  );

  return (
    <Panel width="w-56">
      <PanelHeader
        title="Stroke Paths"
        onClose={onClose}
        toggle={{
          active: paintStrokePathsVisible,
          onToggle: () => setPreferences({ paintStrokePathsVisible: !paintStrokePathsVisible }),
        }}
      />
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-[10px] text-gray-400 font-medium">Display</label>
          <SegmentedControl
            options={displayOptions}
            value={paintStrokePathsMode}
            onChange={(mode) =>
              setPreferences({ paintStrokePathsMode: mode as PaintStrokePathsMode })
            }
          />
        </div>
      </div>
    </Panel>
  );
};

const PaintToolPanels: React.FC<{
  node: AnyNode;
  openPanels: ReadonlySet<string>;
  onPanelClose: (panel: string) => void;
}> = ({ node: _node, openPanels, onPanelClose }) => (
  <>
    {openPanels.has('drawing-tools') && (
      <DrawingToolsPanel onClose={() => onPanelClose('drawing-tools')} />
    )}
    {openPanels.has('nudge') && <NudgePanel onClose={() => onPanelClose('nudge')} />}
    {openPanels.has('stroke-paths') && (
      <StrokePathsPanel onClose={() => onPanelClose('stroke-paths')} />
    )}
  </>
);

export default PaintToolPanels;
