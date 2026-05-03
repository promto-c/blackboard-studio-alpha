import React from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { ImageFitMode, ImageNode, AnyNode } from '@blackboard/types';
import AiAdjustments from '../ai/AiAdjustments';
import { CollapsibleSection, SegmentedControl, Slider } from '@/components';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';

const ImageAdjustments: React.FC<{ node: AnyNode }> = ({ node: anyNode }) => {
  const node = anyNode as ImageNode;
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const { updateNode, setKeyframe } = useEditorActions();

  const colorSpaceOptions = [
    { value: 'sRGB', label: 'sRGB' },
    { value: 'Linear', label: 'Linear' },
    { value: 'Raw', label: 'Raw' },
  ];

  const fitModeOptions = [
    { value: ImageFitMode.FIT, label: 'Fit' },
    { value: ImageFitMode.FILL, label: 'Fill' },
    { value: ImageFitMode.NONE, label: 'None' },
  ];

  const handleUpdate = (updates: Partial<ImageNode>, withHistory = false) => {
    updateNode(node.id, updates, withHistory);
  };

  const handleFitModeChange = (value: string) => {
    const newFitMode = value as ImageFitMode;
    updateNode(node.id, { transform: { ...node.transform, fitMode: newFitMode } }, true);
  };

  const handleColorSpaceChange = (value: 'sRGB' | 'Linear' | 'Raw') => {
    updateNode(node.id, { colorSpace: value }, true);
  };

  const scaleAtCurrentFrame = getValueAtFrame(node.transform.scale, currentFrame);

  return (
    <div>
      {node.aiMetadata && (
        <CollapsibleSection title="AI Generation">
          <AiAdjustments node={node} />
        </CollapsibleSection>
      )}
      <CollapsibleSection title="Color Management" defaultOpen>
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-xs font-medium text-gray-400">Input Color Space</label>
          </div>
          <p className="text-xs text-gray-500 -mt-1 mb-2">
            Defines the color space of the source image file. This is converted to the scene's
            working space for processing.
          </p>
          <SegmentedControl
            value={node.colorSpace}
            options={colorSpaceOptions}
            onChange={handleColorSpaceChange}
          />
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="Transform" defaultOpen>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400">Fit Mode</label>
            <SegmentedControl
              value={node.transform.fitMode}
              options={fitModeOptions}
              onChange={handleFitModeChange}
            />
          </div>
          <Slider
            label="Scale"
            value={scaleAtCurrentFrame}
            min={0.01}
            max={5}
            step={0.01}
            onChange={(v) => {
              handleUpdate({
                transform: { ...node.transform, fitMode: ImageFitMode.NONE },
              });
              setKeyframe(node.id, 'transform.scale', v);
            }}
            onReset={() => {
              handleUpdate(
                {
                  transform: {
                    ...node.transform,
                    fitMode: node.transform.fitMode,
                  },
                },
                true,
              );
            }}
            displayFormatter={(v) => `${(v * 100).toFixed(0)}%`}
            isKeyframed={hasKeyframeAt(node.transform.scale, currentFrame)}
            onToggleKeyframe={() => setKeyframe(node.id, 'transform.scale')}
          />
        </div>
      </CollapsibleSection>
    </div>
  );
};
export default ImageAdjustments;
