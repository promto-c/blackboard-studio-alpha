import React, { useMemo, useState } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { usePreferences, colors } from '@/state/preferencesContext';
import { NodeType, RenderSettings, SceneNode } from '@blackboard/types';
import { CollapsibleSection, StyledDropdown, Slider, ToggleSwitch } from '@/components';
import { renderWithSharedPipeline } from '@/renderer/pipeline';
import { hasRenderableNodes } from '@/effects/effectHelpers';

const SettingRow: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="grid grid-cols-[auto,minmax(0,1fr)] items-center gap-2 text-xs">
    <label className="text-[11px] text-gray-400 whitespace-nowrap">{label}</label>
    <div className="justify-self-end">{children}</div>
  </div>
);

const RenderSettingsPanel: React.FC = () => {
  const renderSettings = useEditorSelector((s) => s.renderSettings);
  const nodes = useEditorSelector((s) => s.nodes);
  const projectId = useEditorSelector((s) => s.projectId);
  const viewerSettings = useEditorSelector((s) => s.viewerSettings);
  const { setRenderSettings, startBackgroundJob, updateBackgroundJob, finishBackgroundJob } =
    useEditorActions();
  const [isExporting, setIsExporting] = useState(false);
  const {
    primaryColor,
    alphaOverlayColorSource,
    alphaOverlayCustomColor,
    alphaOverlayOpacity,
    alphaOverlayBgDarken,
  } = usePreferences();

  const alphaOverlayStyle = useMemo(() => {
    const palette = colors[primaryColor] || colors.teal;
    const accentRgbString = palette[400] || palette[500] || colors.teal[400];
    const [r = 45, g = 212, b = 191] = accentRgbString.split(' ').map(Number);
    const accentColor: [number, number, number] = [r / 255, g / 255, b / 255];

    return {
      color: alphaOverlayColorSource === 'custom' ? alphaOverlayCustomColor : accentColor,
      opacity: alphaOverlayOpacity / 100,
      bgDarken: alphaOverlayBgDarken / 100,
    };
  }, [
    primaryColor,
    alphaOverlayColorSource,
    alphaOverlayCustomColor,
    alphaOverlayOpacity,
    alphaOverlayBgDarken,
  ]);

  const handleSettingChange = (key: keyof RenderSettings, value: string | number) => {
    setRenderSettings({ [key]: value });
  };

  const handleFilenameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRenderSettings({ filename: e.target.value });
  };

  const formatOptions: { value: RenderSettings['format']; label: string }[] = [
    { value: 'image/jpeg', label: 'JPEG' },
    { value: 'image/png', label: 'PNG' },
    { value: 'image/webp', label: 'WebP' },
  ];

  const outputColorSpaceOptions: { value: RenderSettings['outputColorSpace']; label: string }[] = [
    { value: 'scene_linear', label: 'Scene Linear' },
    { value: 'srgb', label: 'sRGB (Standard)' },
    { value: 'match_viewport', label: 'Match Viewport' },
  ];

  const hasRenderableOutput = useMemo(() => hasRenderableNodes(nodes), [nodes]);

  const handleExport = async () => {
    setIsExporting(true);
    let cleanup: (() => void) | null = null;
    let jobId: string | null = null;

    try {
      const sceneNode = nodes.find((node) => node.type === NodeType.SCENE) as SceneNode | undefined;
      if (!sceneNode) {
        alert('Error: No scene found to determine export dimensions.');
        return;
      }

      jobId = startBackgroundJob({
        type: 'render',
        title: `Export ${renderSettings.filename}`,
        subtitle: `${sceneNode.width} x ${sceneNode.height}`,
        detail: 'Rendering frame',
        status: 'running',
        progress: 25,
        indeterminate: true,
        source: { ...(projectId ? { projectId } : {}), nodeId: sceneNode.id },
      });

      const result = await renderWithSharedPipeline({
        nodes: nodes,
        sceneNode,
        frame: 0,
        width: sceneNode.width,
        height: sceneNode.height,
        finalColorSpace: renderSettings.outputColorSpace,
        viewerSettings,
        alphaOverlayStyle: renderSettings.includeAlpha ? undefined : alphaOverlayStyle,
        textureCacheMode: 'none',
      });
      cleanup = result.dispose;
      updateBackgroundJob(jobId, {
        detail: 'Encoding image',
        progress: 80,
        indeterminate: true,
      });

      const blob = await new Promise<Blob | null>((resolve) =>
        result.canvas.toBlob(
          resolve,
          renderSettings.format,
          renderSettings.format === 'image/png' ? undefined : renderSettings.quality / 100,
        ),
      );
      if (!blob) {
        throw new Error('Failed to create blob from canvas.');
      }

      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = `${renderSettings.filename}.${renderSettings.format.split('/')[1]}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      finishBackgroundJob(jobId, {
        status: 'complete',
        detail: link.download,
        progress: 100,
      });
    } catch (error) {
      console.error('Export failed:', error);
      if (jobId) {
        finishBackgroundJob(jobId, {
          status: 'error',
          detail: error instanceof Error ? error.message : String(error),
          error: error instanceof Error ? error.message : String(error),
          progress: 100,
        });
      }
      alert(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      cleanup?.();
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-3">
      <SettingRow label="Filename">
        <input
          type="text"
          name="filename"
          value={renderSettings.filename}
          onChange={handleFilenameChange}
          className="w-44 bg-gray-700/50 text-gray-200 text-xs rounded-md focus:outline-none focus:ring-1 focus:ring-offset-0 focus:ring-offset-gray-900 focus:ring-primary-700 block px-2.5 py-1.5 font-mono border-0"
        />
      </SettingRow>

      <SettingRow label="Format">
        <StyledDropdown
          value={renderSettings.format}
          options={formatOptions}
          onChange={(value) => handleSettingChange('format', value)}
          widthClass="w-44"
        />
      </SettingRow>

      <SettingRow label="Output Color Space">
        <StyledDropdown
          value={renderSettings.outputColorSpace}
          options={outputColorSpaceOptions}
          onChange={(value) => handleSettingChange('outputColorSpace', value)}
          widthClass="w-44"
        />
      </SettingRow>

      {(renderSettings.format === 'image/jpeg' || renderSettings.format === 'image/webp') && (
        <Slider
          label="Quality"
          value={renderSettings.quality}
          min={1}
          max={100}
          step={1}
          onChange={(value) => handleSettingChange('quality', value)}
          onReset={() => handleSettingChange('quality', 90)}
        />
      )}

      {(renderSettings.format === 'image/png' || renderSettings.format === 'image/webp') && (
        <div className="py-1">
          <ToggleSwitch
            checked={renderSettings.includeAlpha}
            onCheckedChange={(checked) => handleSettingChange('includeAlpha', checked)}
            label="Alpha Channel"
            description={
              renderSettings.includeAlpha ? 'Transparent background' : 'Solid background'
            }
            size="sm"
          />
        </div>
      )}
      <div className="pt-1">
        <button
          onClick={handleExport}
          disabled={isExporting || !hasRenderableOutput}
          className="w-full px-3 py-1.5 text-xs font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75 transition disabled:bg-gray-600 disabled:cursor-not-allowed"
        >
          {isExporting ? 'Exporting...' : 'Export Image'}
        </button>
        {!hasRenderableOutput && (
          <p className="text-xs text-center text-gray-500 mt-2">
            Add an image, sequence, video, or text node to the project to enable export.
          </p>
        )}
      </div>
    </div>
  );
};

const OutputAdjustments: React.FC = () => {
  return (
    <div>
      <CollapsibleSection title="Render Settings" defaultOpen>
        <RenderSettingsPanel />
      </CollapsibleSection>
    </div>
  );
};

export default OutputAdjustments;
