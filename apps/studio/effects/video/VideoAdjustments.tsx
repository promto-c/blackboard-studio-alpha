import React from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { ImageFitMode, VideoNode, AnyNode } from '@blackboard/types';
import { Slider, CollapsibleSection, SegmentedControl, ToggleSwitch } from '@/components';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';

const VideoAdjustments: React.FC<{ node: AnyNode }> = ({ node: anyNode }) => {
  const node = anyNode as VideoNode;
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const { updateNode, setKeyframe } = useEditorActions();

  const fitModeOptions = [
    { value: ImageFitMode.FIT, label: 'Fit' },
    { value: ImageFitMode.FILL, label: 'Fill' },
    { value: ImageFitMode.NONE, label: 'None' },
  ];

  const handleUpdate = (updates: Partial<VideoNode>, withHistory: boolean = false) => {
    updateNode(node.id, updates, withHistory);
  };

  const handleFitModeChange = (value: string) => {
    const newFitMode = value as ImageFitMode;
    updateNode(node.id, { transform: { ...node.transform, fitMode: newFitMode } }, true);
  };

  const scaleAtCurrentFrame = getValueAtFrame(node.transform.scale, currentFrame);

  return (
    <div>
      <CollapsibleSection title="Playback" defaultOpen>
        <ToggleSwitch
          label="Loop"
          checked={node.loop}
          onCheckedChange={(checked) => handleUpdate({ loop: checked }, true)}
        />
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
export default VideoAdjustments;
