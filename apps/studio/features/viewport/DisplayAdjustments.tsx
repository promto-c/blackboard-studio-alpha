import React, { useMemo } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { useOcio } from '@/state/ocioContext';
import { ViewerSettings } from '@blackboard/types';
import {
  CollapsibleSection,
  Slider,
  StyledDropdown,
  SegmentedControl,
  HotkeyBadge,
} from '@/components';

const DisplayAdjustments: React.FC = () => {
  const viewerSettings = useEditorSelector((s) => s.viewerSettings);
  const { setViewerSettings } = useEditorActions();
  const ocio = useOcio();

  const handleSettingChange = <K extends keyof ViewerSettings>(
    key: K,
    value: ViewerSettings[K],
  ) => {
    setViewerSettings({ [key]: value });
  };

  const availableViews = useMemo(() => {
    if (!ocio.isInitialized)
      return [
        { value: 'sRGB', label: 'sRGB' },
        { value: 'Raw', label: 'Raw' },
      ];
    return ocio.views.map((view) => ({ value: view, label: view }));
  }, [ocio]);

  const channelOptions = (['RGB', 'R', 'G', 'B', 'A'] as const).map((ch) => ({
    value: ch,
    label: ch,
  }));
  const alphaOverlayOptions = [
    { value: 'ON', label: 'on' },
    { value: 'OFF', label: 'off' },
  ];
  const alphaModeOptions = (['STRAIGHT', 'TRANSPARENT', 'FILL_BLACK', 'FILL_WHITE'] as const).map(
    (mode) => ({ value: mode, label: mode.replace('_', ' ').toLowerCase() }),
  );

  return (
    <div className="space-y-4">
      {ocio.isInitialized && (
        <CollapsibleSection title="Color Management (OCIO)" defaultOpen>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-400">View Transform</label>
              <StyledDropdown
                value={viewerSettings.ocioView}
                options={availableViews}
                onChange={(value) => handleSettingChange('ocioView', value as string)}
              />
            </div>
          </div>
        </CollapsibleSection>
      )}

      <CollapsibleSection title="Exposure & Color" defaultOpen>
        <div className="space-y-4">
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
      </CollapsibleSection>

      <CollapsibleSection title="Channels & Alpha" defaultOpen>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400">Channels</label>
            <SegmentedControl
              value={viewerSettings.channels}
              options={channelOptions}
              onChange={(value) =>
                handleSettingChange('channels', value as ViewerSettings['channels'])
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400">Alpha Mode</label>
            <SegmentedControl
              value={viewerSettings.alphaMode}
              options={alphaModeOptions}
              onChange={(value) =>
                handleSettingChange('alphaMode', value as ViewerSettings['alphaMode'])
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400 inline-flex items-center gap-2">
              <span>Alpha Overlay</span>
              <HotkeyBadge combo="Shift+A" />
            </label>
            <SegmentedControl
              value={viewerSettings.alphaOverlay ? 'ON' : 'OFF'}
              options={alphaOverlayOptions}
              onChange={(value) => handleSettingChange('alphaOverlay', value === 'ON')}
            />
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
};

export default DisplayAdjustments;
