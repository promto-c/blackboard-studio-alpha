import React, { useState, useEffect } from 'react';
import { AnyNode, SceneNode } from '@blackboard/types';
import { useEditorActions } from '@/state/editorContext';
import { StyledDropdown } from '@/components';

const SettingRow: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="flex justify-between items-center text-xs">
    <label className="text-gray-400">{label}</label>
    {children}
  </div>
);

const colorSpaceOptions: { value: 'sRGB' | 'Linear'; label: string }[] = [
  { value: 'sRGB', label: 'sRGB' },
  { value: 'Linear', label: 'Linear (scene-referred)' },
];

const bitDepthOptions: { value: 8 | 16 | 32; label: string }[] = [
  { value: 8, label: '8-bit integer' },
  { value: 16, label: '16-bit float' },
  { value: 32, label: '32-bit float' },
];

const fpsOptions: { value: number; label: string }[] = [
  { value: 23.976, label: '23.976 fps' },
  { value: 24, label: '24 fps' },
  { value: 25, label: '25 fps' },
  { value: 30, label: '30 fps' },
  { value: 60, label: '60 fps' },
];

const SceneAdjustments: React.FC<{ node: AnyNode }> = ({ node: anyNode }) => {
  const sceneNode = anyNode as SceneNode;
  const { updateNode, setMaxFrames } = useEditorActions();

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
      // Revert if invalid
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
    <div className="p-4 bg-gray-800/50 rounded-lg space-y-4">
      <SettingRow label="Resolution">
        <div className="flex items-center gap-2 w-40">
          <input
            type="number"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            onBlur={handleDimensionBlur}
            onKeyDown={handleKeyDown}
            className="bg-gray-700/50 text-gray-200 text-xs rounded focus:outline-none focus:ring-2 focus:ring-offset-0 focus:ring-offset-gray-900 focus:ring-primary-700 block p-2 font-mono w-full flex items-center justify-between text-left border-0"
            min="1"
          />
          <span className="text-gray-500 -mx-1">x</span>
          <input
            type="number"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            onBlur={handleDimensionBlur}
            onKeyDown={handleKeyDown}
            className="bg-gray-700/50 text-gray-200 text-xs rounded focus:outline-none focus:ring-2 focus:ring-offset-0 focus:ring-offset-gray-900 focus:ring-primary-700 block p-2 font-mono w-full flex items-center justify-between text-left border-0"
            min="1"
          />
        </div>
      </SettingRow>

      <SettingRow label="Timeline Duration">
        <div className="w-40">
          <input
            type="number"
            value={maxFramesInput}
            onChange={(e) => setMaxFramesInput(e.target.value)}
            onBlur={handleMaxFramesBlur}
            onKeyDown={handleKeyDown}
            className="bg-gray-700/50 text-gray-200 text-xs rounded focus:outline-none focus:ring-2 focus:ring-offset-0 focus:ring-offset-gray-900 focus:ring-primary-700 block p-2 font-mono w-full flex items-center justify-between text-left border-0"
            min="0"
            step="1"
          />
        </div>
      </SettingRow>

      <SettingRow label="Frame Rate (FPS)">
        <StyledDropdown
          value={sceneNode.fps || 30}
          options={fpsOptions}
          onChange={(value) => handleUpdate({ fps: value })}
          widthClass="w-40"
          popoverWidthClass="w-40"
        />
      </SettingRow>

      <SettingRow label="Working Space">
        <StyledDropdown
          value={sceneNode.colorSpace}
          options={colorSpaceOptions}
          onChange={(value) => handleUpdate({ colorSpace: value as 'sRGB' | 'Linear' })}
          widthClass="w-40"
          popoverWidthClass="w-48"
        />
      </SettingRow>

      <SettingRow label="Bit Depth">
        <StyledDropdown
          value={sceneNode.bitDepth}
          options={bitDepthOptions}
          onChange={(value) => handleUpdate({ bitDepth: value as 8 | 16 | 32 })}
          widthClass="w-40"
          popoverWidthClass="w-48"
        />
      </SettingRow>
    </div>
  );
};

export default SceneAdjustments;
