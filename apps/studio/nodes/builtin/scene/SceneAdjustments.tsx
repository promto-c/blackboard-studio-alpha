import React, { useState, useEffect } from 'react';
import { AnyNode, SceneNode } from '@blackboard/types';
import { useEditorActions } from '@/state/editorContext';
import { SettingRow } from '@/components/SettingRow';
import { OcioColorSpaceDropdown } from '@/components/OcioColorSpaceDropdown';
import { SegmentedControl } from '@/components/SegmentedControl';
import {
  CollapsibleSection,
  SplitControl,
  SplitControlAction,
  StyledDropdown,
} from '@blackboard/ui';
import * as Icons from '@blackboard/icons';
import { usePreferencesNavigation } from '@/features/projects/preferencesNavigation';

const bitDepthOptions: { value: 8 | 16 | 32; label: string }[] = [
  { value: 8, label: '8-bit' },
  { value: 16, label: '16-bit' },
  { value: 32, label: '32-bit' },
];

const fpsOptions: { value: number; label: string }[] = [
  { value: 23.976, label: '23.976 fps' },
  { value: 24, label: '24 fps' },
  { value: 25, label: '25 fps' },
  { value: 30, label: '30 fps' },
  { value: 60, label: '60 fps' },
];

const PROPERTY_ROW_CLASS =
  '!grid min-h-10 grid-cols-[minmax(0,1fr)_12rem] items-center gap-3 py-0.5';

const INPUT_CLASS_NAME =
  'bb-control-input block min-h-9 w-full border-0 px-2.5 py-2 font-mono text-xs tabular-nums text-gray-200 outline-none';

function SceneAdjustments({ node: anyNode }: { node: AnyNode }) {
  const sceneNode = anyNode as SceneNode;
  const { updateNode, setMaxFrames } = useEditorActions();
  const { openPreferences } = usePreferencesNavigation();

  const [width, setWidth] = useState(String(sceneNode.width));
  const [height, setHeight] = useState(String(sceneNode.height));
  const [maxFramesInput, setMaxFramesInput] = useState(String(sceneNode.maxFrames));

  useEffect(() => {
    setWidth(String(sceneNode.width));
    setHeight(String(sceneNode.height));
    setMaxFramesInput(String(sceneNode.maxFrames));
  }, [sceneNode.width, sceneNode.height, sceneNode.maxFrames]);

  const handleUpdate = (updates: Partial<SceneNode>) => {
    updateNode(sceneNode.id, updates, true);
  };

  const handleDimensionBlur = () => {
    const newWidth = parseInt(width, 10);
    const newHeight = parseInt(height, 10);
    const hasChanged = newWidth !== sceneNode.width || newHeight !== sceneNode.height;

    if (hasChanged && newWidth > 0 && newHeight > 0) {
      updateNode(sceneNode.id, { width: newWidth, height: newHeight }, true);
    } else {
      setWidth(String(sceneNode.width));
      setHeight(String(sceneNode.height));
    }
  };

  const handleMaxFramesBlur = () => {
    const newMaxFrames = parseInt(maxFramesInput, 10);
    if (newMaxFrames >= 0 && newMaxFrames !== sceneNode.maxFrames) {
      setMaxFrames(newMaxFrames);
    } else {
      setMaxFramesInput(String(sceneNode.maxFrames));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div>
      <CollapsibleSection title="Composition" defaultOpen>
        <div>
          <SettingRow label="Resolution" className={PROPERTY_ROW_CLASS}>
            <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
              <input
                type="number"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                onBlur={handleDimensionBlur}
                onKeyDown={handleKeyDown}
                className={INPUT_CLASS_NAME}
                min="1"
                aria-label="Resolution width"
              />
              <span aria-hidden="true" className="text-[10px] font-medium text-gray-600">
                ×
              </span>
              <input
                type="number"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                onBlur={handleDimensionBlur}
                onKeyDown={handleKeyDown}
                className={INPUT_CLASS_NAME}
                min="1"
                aria-label="Resolution height"
              />
            </div>
          </SettingRow>

          <SettingRow label="Timeline Duration" className={PROPERTY_ROW_CLASS}>
            <input
              type="number"
              value={maxFramesInput}
              onChange={(e) => setMaxFramesInput(e.target.value)}
              onBlur={handleMaxFramesBlur}
              onKeyDown={handleKeyDown}
              className={INPUT_CLASS_NAME}
              min="0"
              step="1"
              aria-label="Timeline duration in frames"
            />
          </SettingRow>

          <SettingRow label="Frame Rate" className={PROPERTY_ROW_CLASS}>
            <StyledDropdown
              value={sceneNode.fps || 30}
              options={fpsOptions}
              onChange={(value) => handleUpdate({ fps: value as number })}
              widthClass="w-full"
              popoverWidthClass="w-48"
            />
          </SettingRow>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Color Pipeline" defaultOpen>
        <div>
          <SettingRow label="Working Space" className={PROPERTY_ROW_CLASS}>
            <SplitControl className="w-full">
              <div className="min-w-0 flex-1 overflow-hidden">
                <OcioColorSpaceDropdown
                  value={sceneNode.colorSpace}
                  onChange={(value) =>
                    handleUpdate({ colorSpace: value as SceneNode['colorSpace'] })
                  }
                  includeData={false}
                  widthClass="w-full"
                  popoverWidthClass="w-80"
                />
              </div>
              <SplitControlAction
                onClick={() =>
                  openPreferences({
                    section: 'colorManagement',
                    colorScope: 'project',
                  })
                }
                title="Open project color settings"
                aria-label="Open project color settings"
              >
                <Icons.Cog className="h-4 w-4" />
              </SplitControlAction>
            </SplitControl>
          </SettingRow>

          <SettingRow label="Bit Depth" className={PROPERTY_ROW_CLASS}>
            <SegmentedControl
              value={sceneNode.bitDepth}
              options={bitDepthOptions}
              onChange={(value) => handleUpdate({ bitDepth: Number(value) as 8 | 16 | 32 })}
              className="w-full"
            />
          </SettingRow>
        </div>
      </CollapsibleSection>
    </div>
  );
}

export default SceneAdjustments;
