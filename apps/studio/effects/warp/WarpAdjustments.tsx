import React from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { AnyNode, WarpNode } from '@blackboard/types';
import { CollapsibleSection, Slider } from '@/components';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';
import * as Icons from '@blackboard/icons';

const WarpAdjustments: React.FC<{ node: AnyNode }> = ({ node: anyNode }) => {
  const node = anyNode as WarpNode;
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const { updateNode, setKeyframe } = useEditorActions();

  const handleClearPins = () => {
    if (window.confirm('Remove all pins?')) {
      updateNode(node.id, { pins: [] }, true);
    }
  };

  const radiusVal = getValueAtFrame(node.radius, currentFrame);
  const strengthVal = getValueAtFrame(node.strength, currentFrame);

  return (
    <div>
      <CollapsibleSection title="Settings" defaultOpen>
        <div className="space-y-4">
          <Slider
            label="Pin Radius"
            value={radiusVal}
            min={0.01}
            max={1.0}
            step={0.01}
            onChange={(v) => setKeyframe(node.id, 'radius', v)}
            onReset={() => setKeyframe(node.id, 'radius', 0.2, true)}
            displayFormatter={(v) => v.toFixed(2)}
            isKeyframed={hasKeyframeAt(node.radius, currentFrame)}
            onToggleKeyframe={() => setKeyframe(node.id, 'radius')}
          />
          <Slider
            label="Strength"
            value={strengthVal}
            min={0}
            max={2.0}
            step={0.01}
            onChange={(v) => setKeyframe(node.id, 'strength', v)}
            onReset={() => setKeyframe(node.id, 'strength', 1.0, true)}
            displayFormatter={(v) => v.toFixed(2)}
            isKeyframed={hasKeyframeAt(node.strength, currentFrame)}
            onToggleKeyframe={() => setKeyframe(node.id, 'strength')}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Pins" defaultOpen>
        <div className="flex items-center justify-between p-2 bg-gray-800/50 rounded-md">
          <span className="text-xs text-gray-400">{node.pins.length} pins active</span>
          <button
            onClick={handleClearPins}
            className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors"
            title="Delete All Pins"
          >
            <Icons.Trash className="h-4 w-4" />
          </button>
        </div>
        <p className="text-[10px] text-gray-500 mt-2 px-1">
          Use the Viewport Tools to add or move pins. Distort the image by dragging pins.
        </p>
      </CollapsibleSection>
    </div>
  );
};

export default WarpAdjustments;
