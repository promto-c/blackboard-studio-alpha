import React from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { ImageFitMode, ImageSequenceNode, AnyNode } from '@blackboard/types';
import { CollapsibleSection, Slider, SegmentedControl, ToggleSwitch } from '@/components';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';

const ImageSequenceAdjustments: React.FC<{ node: AnyNode }> = ({ node: anyNode }) => {
  const node = anyNode as ImageSequenceNode;
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

  const handleUpdate = (updates: Partial<ImageSequenceNode>, withHistory: boolean = false) => {
    updateNode(node.id, updates, withHistory);
  };

  const handleColorSpaceChange = (value: string) => {
    handleUpdate({ colorSpace: value as ImageSequenceNode['colorSpace'] }, true);
  };

  const scaleAtCurrentFrame = getValueAtFrame(node.transform.scale, currentFrame);

  return (
    <div>
      <CollapsibleSection title="Color Management" defaultOpen>
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-xs font-medium text-gray-400">Input Color Space</label>
          </div>
          <p className="text-xs text-gray-500 -mt-1 mb-2">
            Defines the color space of the source sequence. This is converted to the scene's working
            space for processing.
          </p>
          <SegmentedControl
            value={node.colorSpace ?? 'sRGB'}
            options={colorSpaceOptions}
            onChange={handleColorSpaceChange}
          />
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="Playback" defaultOpen>
        <div className="space-y-4">
          <div className="p-2 bg-gray-900/50 rounded-md border border-gray-800">
            <p className="text-[10px] text-gray-500 uppercase font-semibold">Sequence Info</p>
            <p className="text-xs text-gray-300 mt-1">{node.frames.length} frames detected</p>
          </div>
          <Slider
            label="Start Frame Offset"
            value={node.startFrame}
            min={-1000}
            max={1000}
            step={1}
            onChange={(v) => handleUpdate({ startFrame: v }, true)}
            onReset={() => handleUpdate({ startFrame: 0 }, true)}
          />
          <ToggleSwitch
            label="Loop Sequence"
            checked={node.loop}
            onCheckedChange={(checked) => handleUpdate({ loop: checked }, true)}
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
              onChange={(value) => {
                handleUpdate(
                  {
                    transform: {
                      ...node.transform,
                      fitMode: value as ImageFitMode,
                    },
                  },
                  true,
                );
              }}
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
export default ImageSequenceAdjustments;
