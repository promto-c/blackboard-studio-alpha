import React, { useState } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { ImageFitMode, ImageNode, AnyNode } from '@blackboard/types';
import { Link } from '@blackboard/icons';
import AiAdjustments from '../ai/AiAdjustments';
import { CollapsibleSection, SegmentedControl, Slider } from '@/components';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';

const ImageAdjustments: React.FC<{ node: AnyNode }> = ({ node: anyNode }) => {
  const node = anyNode as ImageNode;
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const { updateNode, setKeyframe } = useEditorActions();
  const [scaleLinked, setScaleLinked] = useState(true);

  const colorSpaceOptions = [
    { value: 'sRGB', label: 'sRGB' },
    { value: 'Linear', label: 'Linear' },
    { value: 'Raw', label: 'Raw' },
  ];

  const fitModeOptions = [
    { value: ImageFitMode.FIT, label: 'Fit' },
    { value: ImageFitMode.FILL, label: 'Fill' },
    { value: ImageFitMode.NONE, label: 'None' },
    { value: ImageFitMode.STRETCH, label: 'Stretch' },
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

  const scaleXAtCurrentFrame = getValueAtFrame(node.transform.scaleX, currentFrame);
  const scaleYAtCurrentFrame = getValueAtFrame(node.transform.scaleY, currentFrame);

  const handleScaleChange = (axis: 'x' | 'y', v: number) => {
    const nextScaleX = axis === 'x' ? v : scaleLinked ? v : scaleXAtCurrentFrame;
    const nextScaleY = axis === 'y' ? v : scaleLinked ? v : scaleYAtCurrentFrame;
    handleUpdate({
      transform: { ...node.transform, fitMode: ImageFitMode.NONE },
    });
    setKeyframe(node.id, 'transform.scaleX', nextScaleX);
    if (scaleLinked) {
      setKeyframe(node.id, 'transform.scaleY', nextScaleY);
    } else if (axis === 'y') {
      setKeyframe(node.id, 'transform.scaleY', v);
    }
  };

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
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <Slider
                  label="Scale X"
                  value={scaleXAtCurrentFrame}
                  min={0.01}
                  max={5}
                  step={0.01}
                  onChange={(v) => handleScaleChange('x', v)}
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
                    setKeyframe(node.id, 'transform.scaleX', 1);
                  }}
                  displayFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                  isKeyframed={hasKeyframeAt(node.transform.scaleX, currentFrame)}
                  onToggleKeyframe={() => setKeyframe(node.id, 'transform.scaleX')}
                />
              </div>
              <button
                type="button"
                onClick={() => setScaleLinked(!scaleLinked)}
                className={`flex-shrink-0 mt-6 rounded p-1 transition ${
                  scaleLinked
                    ? 'text-primary-400 hover:text-primary-300'
                    : 'text-gray-600 hover:text-gray-400'
                }`}
                title={scaleLinked ? 'Unlink scale axes' : 'Link scale axes'}
              >
                <Link className="h-4 w-4" />
              </button>
              <div className="flex-1 min-w-0">
                <Slider
                  label="Scale Y"
                  value={scaleYAtCurrentFrame}
                  min={0.01}
                  max={5}
                  step={0.01}
                  onChange={(v) => handleScaleChange('y', v)}
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
                    setKeyframe(node.id, 'transform.scaleY', 1);
                  }}
                  displayFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                  isKeyframed={hasKeyframeAt(node.transform.scaleY, currentFrame)}
                  onToggleKeyframe={() => setKeyframe(node.id, 'transform.scaleY')}
                />
              </div>
            </div>
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
};
export default ImageAdjustments;
