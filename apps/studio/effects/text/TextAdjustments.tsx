import React from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { AnyNode, TextNode } from '@blackboard/types';
import { Slider, CollapsibleSection, ColorPicker, StyledDropdown } from '@/components';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';

const FONT_OPTIONS = [
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'Verdana, sans-serif', label: 'Verdana' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: '"Times New Roman", Times, serif', label: 'Times New Roman' },
  { value: '"Courier New", Courier, monospace', label: 'Courier New' },
  { value: 'Impact, fantasy', label: 'Impact' },
];

const TextAdjustments: React.FC<{ node: AnyNode }> = ({ node: anyNode }) => {
  const node = anyNode as TextNode;
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const { updateNode, setKeyframe } = useEditorActions();

  const handleUpdate = (updates: Partial<TextNode>, withHistory: boolean = false) => {
    updateNode(node.id, updates, withHistory);
  };

  const valuesAtFrame = {
    fontSize: getValueAtFrame(node.fontSize, currentFrame),
    rotation: getValueAtFrame(node.rotation, currentFrame),
    positionX: getValueAtFrame(node.position.x, currentFrame),
    positionY: getValueAtFrame(node.position.y, currentFrame),
    opacity: getValueAtFrame(node.opacity, currentFrame),
  };

  return (
    <div>
      <CollapsibleSection title="Content" defaultOpen>
        <div className="space-y-4">
          <div>
            <label
              htmlFor={`text-content-${node.id}`}
              className="text-xs font-medium text-gray-400"
            >
              Text
            </label>
            <textarea
              id={`text-content-${node.id}`}
              value={node.text}
              onChange={(e) => handleUpdate({ text: e.target.value })}
              onBlur={() => handleUpdate({ text: node.text }, true)}
              rows={3}
              className="mt-1 w-full bg-gray-700 border border-gray-600 text-gray-200 text-sm rounded-md focus:ring-primary-500 focus:border-primary-500 block p-2 resize-y"
            />
          </div>
          <div>
            <label htmlFor={`font-family-${node.id}`} className="text-xs font-medium text-gray-400">
              Font
            </label>
            <StyledDropdown
              value={node.fontFamily}
              options={FONT_OPTIONS}
              onChange={(value) => handleUpdate({ fontFamily: value }, true)}
            />
          </div>
          <ColorPicker
            label="Color"
            value={node.color}
            onChange={(v) => handleUpdate({ color: v }, true)}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Transform & Style" defaultOpen>
        <div className="space-y-4">
          <Slider
            label="Font Size"
            value={valuesAtFrame.fontSize}
            min={1}
            max={500}
            step={1}
            onChange={(v) => setKeyframe(node.id, 'fontSize', v)}
            onReset={() => setKeyframe(node.id, 'fontSize', 100, true)}
            displayFormatter={(v) => `${v.toFixed(0)}px`}
            isKeyframed={hasKeyframeAt(node.fontSize, currentFrame)}
            onToggleKeyframe={() => setKeyframe(node.id, 'fontSize')}
          />
          <Slider
            label="Rotation"
            value={valuesAtFrame.rotation}
            min={-180}
            max={180}
            step={1}
            onChange={(v) => setKeyframe(node.id, 'rotation', v)}
            onReset={() => setKeyframe(node.id, 'rotation', 0, true)}
            displayFormatter={(v) => `${v.toFixed(0)}°`}
            isKeyframed={hasKeyframeAt(node.rotation, currentFrame)}
            onToggleKeyframe={() => setKeyframe(node.id, 'rotation')}
          />
          <Slider
            label="Position X"
            value={valuesAtFrame.positionX}
            min={-2000}
            max={2000}
            step={1}
            onChange={(v) => setKeyframe(node.id, 'position.x', v)}
            onReset={() => setKeyframe(node.id, 'position.x', 0, true)}
            displayFormatter={(v) => `${v.toFixed(0)}px`}
            isKeyframed={hasKeyframeAt(node.position.x, currentFrame)}
            onToggleKeyframe={() => setKeyframe(node.id, 'position.x')}
          />
          <Slider
            label="Position Y"
            value={valuesAtFrame.positionY}
            min={-2000}
            max={2000}
            step={1}
            onChange={(v) => setKeyframe(node.id, 'position.y', v)}
            onReset={() => setKeyframe(node.id, 'position.y', 0, true)}
            displayFormatter={(v) => `${v.toFixed(0)}px`}
            isKeyframed={hasKeyframeAt(node.position.y, currentFrame)}
            onToggleKeyframe={() => setKeyframe(node.id, 'position.y')}
          />
        </div>
      </CollapsibleSection>
    </div>
  );
};
export default TextAdjustments;
