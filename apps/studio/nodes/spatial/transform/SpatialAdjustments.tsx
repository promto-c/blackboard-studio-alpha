import { useRef, useState } from 'react';
import {
  AnyNode,
  CropNode,
  NodeType,
  ReformatNode,
  ReformatResizeMode,
  SceneNode,
  SpatialResamplingFilter,
  TransformNode,
} from '@blackboard/types';
import { getValueAtFrame, hasKeyframeAt } from '@blackboard/renderer';
import { CollapsibleSection, Slider } from '@blackboard/ui';
import { SegmentedControl, SettingRow, ShaderCodeButton } from '@/components';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { Link } from '@blackboard/icons';
import { SpatialShader } from './spatialShaders';

const REFORMAT_MODE_OPTIONS: Array<{ value: ReformatResizeMode; label: string }> = [
  { value: 'fill', label: 'Fill' },
  { value: 'fit', label: 'Fit' },
  { value: 'none', label: 'None' },
  { value: 'stretch', label: 'Stretch' },
];

const RESAMPLING_OPTIONS: Array<{
  value: SpatialResamplingFilter;
  label: string;
}> = [
  { value: 'nearest', label: 'Nearest' },
  { value: 'linear', label: 'Linear' },
  { value: 'cubic', label: 'Cubic' },
  { value: 'lanczos', label: 'Lanczos' },
];

const clampDimension = (value: number, fallback: number): number => {
  const parsed = Math.round(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, parsed);
};

const formatPixels = (value: number) => `${Math.round(value)}px`;
const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

function ResamplingControl({
  value = 'linear',
  onChange,
}: {
  value: SpatialResamplingFilter | undefined;
  onChange: (value: SpatialResamplingFilter) => void;
}) {
  return (
    <SettingRow label="Resampling Filter">
      <SegmentedControl
        options={RESAMPLING_OPTIONS}
        value={value}
        onChange={(nextValue) => onChange(nextValue as SpatialResamplingFilter)}
        className="w-full"
      />
    </SettingRow>
  );
}

export function TransformAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as TransformNode;
  const currentFrame = useEditorSelector((state) => state.currentFrame);
  const { setKeyframe, updateNode } = useEditorActions();
  const [scaleLinked, setScaleLinked] = useState(true);
  const transform = node.transform;
  const scaleXAtFrame = getValueAtFrame(transform.scaleX, currentFrame);
  const scaleYAtFrame = getValueAtFrame(transform.scaleY, currentFrame);

  const handleChange = (key: keyof TransformNode['transform'], value: number) => {
    setKeyframe(node.id, `transform.${key}`, value);
  };

  const handleScaleChange = (axis: 'x' | 'y', value: number) => {
    if (axis === 'x' || scaleLinked) {
      setKeyframe(node.id, 'transform.scaleX', value);
    }
    if (axis === 'y' || scaleLinked) {
      setKeyframe(node.id, 'transform.scaleY', value);
    }
  };

  const handleScaleReset = (axis: 'x' | 'y') => {
    if (axis === 'x' || scaleLinked) {
      setKeyframe(node.id, 'transform.scaleX', 1, true);
    }
    if (axis === 'y' || scaleLinked) {
      setKeyframe(node.id, 'transform.scaleY', 1, true);
    }
  };

  const handleReset = (key: keyof TransformNode['transform'], value: number) => () => {
    setKeyframe(node.id, `transform.${key}`, value, true);
  };

  const renderSlider = (
    key: keyof TransformNode['transform'],
    label: string,
    min: number,
    max: number,
    step: number,
    defaultValue: number,
    displayFormatter: (value: number) => string,
  ) => (
    <Slider
      label={label}
      value={getValueAtFrame(transform[key], currentFrame)}
      min={min}
      max={max}
      step={step}
      onChange={(value) => handleChange(key, value)}
      onReset={handleReset(key, defaultValue)}
      displayFormatter={displayFormatter}
      isKeyframed={hasKeyframeAt(transform[key], currentFrame)}
      onToggleKeyframe={() => setKeyframe(node.id, `transform.${key}`)}
    />
  );

  return (
    <>
      <CollapsibleSection title="Transform" defaultOpen>
        <div className="space-y-4">
          {renderSlider('translateX', 'Translate X', -2000, 2000, 1, 0, formatPixels)}
          {renderSlider('translateY', 'Translate Y', -2000, 2000, 1, 0, formatPixels)}
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <Slider
                label="Scale X"
                value={scaleXAtFrame}
                min={-4}
                max={4}
                step={0.01}
                onChange={(value) => handleScaleChange('x', value)}
                onReset={() => handleScaleReset('x')}
                displayFormatter={formatPercent}
                isKeyframed={hasKeyframeAt(transform.scaleX, currentFrame)}
                onToggleKeyframe={() => setKeyframe(node.id, 'transform.scaleX')}
              />
            </div>
            <button
              type="button"
              onClick={() => setScaleLinked(!scaleLinked)}
              className={`mt-6 shrink-0 rounded p-1 transition ${
                scaleLinked
                  ? 'text-primary-400 hover:text-primary-300'
                  : 'text-gray-600 hover:text-gray-400'
              }`}
              title={scaleLinked ? 'Unlink scale axes' : 'Link scale axes'}
            >
              <Link className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <Slider
                label="Scale Y"
                value={scaleYAtFrame}
                min={-4}
                max={4}
                step={0.01}
                onChange={(value) => handleScaleChange('y', value)}
                onReset={() => handleScaleReset('y')}
                displayFormatter={formatPercent}
                isKeyframed={hasKeyframeAt(transform.scaleY, currentFrame)}
                onToggleKeyframe={() => setKeyframe(node.id, 'transform.scaleY')}
              />
            </div>
          </div>
          <ResamplingControl
            value={node.resampling}
            onChange={(resampling) => updateNode(node.id, { resampling }, true)}
          />
          {renderSlider(
            'rotation',
            'Rotation',
            -180,
            180,
            0.1,
            0,
            (value) => `${value.toFixed(1)} deg`,
          )}
          <div className="grid grid-cols-2 gap-3">
            {renderSlider('pivotX', 'Pivot X', -2000, 2000, 1, 0, formatPixels)}
            {renderSlider('pivotY', 'Pivot Y', -2000, 2000, 1, 0, formatPixels)}
          </div>
        </div>
      </CollapsibleSection>
      <ShaderCodeButton title={`${node.name} GLSL Code`} code={SpatialShader.TRANSFORM} />
    </>
  );
}

export function CropAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as CropNode;
  const currentFrame = useEditorSelector((state) => state.currentFrame);
  const { setKeyframe } = useEditorActions();
  const crop = node.crop;

  const handleCropChange = (key: keyof CropNode['crop'], value: number) => {
    setKeyframe(node.id, `crop.${key}`, value);
  };

  const renderCropSlider = (key: 'left' | 'right' | 'top' | 'bottom', label: string) => (
    <Slider
      label={label}
      value={getValueAtFrame(crop[key], currentFrame)}
      min={0}
      max={2000}
      step={1}
      onChange={(value) => handleCropChange(key, value)}
      onReset={() => setKeyframe(node.id, `crop.${key}`, 0, true)}
      displayFormatter={formatPixels}
      isKeyframed={hasKeyframeAt(crop[key], currentFrame)}
      onToggleKeyframe={() => setKeyframe(node.id, `crop.${key}`)}
    />
  );

  return (
    <>
      <CollapsibleSection title="Crop" defaultOpen>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {renderCropSlider('left', 'Left')}
            {renderCropSlider('right', 'Right')}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {renderCropSlider('top', 'Top')}
            {renderCropSlider('bottom', 'Bottom')}
          </div>
        </div>
      </CollapsibleSection>
      <ShaderCodeButton title={`${node.name} GLSL Code`} code={SpatialShader.CROP} />
    </>
  );
}

function SizeControls({
  width,
  height,
  defaultSize,
  mode,
  onSizeChange,
  onModeChange,
}: {
  width: number;
  height: number;
  defaultSize: { width: number; height: number };
  mode: ReformatResizeMode;
  onSizeChange: (width: number, height: number, withHistory?: boolean) => void;
  onModeChange: (mode: ReformatResizeMode) => void;
}) {
  const [dimensionsLinked, setDimensionsLinked] = useState(true);
  const pendingSizeRef = useRef<{ width: number; height: number } | null>(null);
  const sliderMax = Math.max(8192, width * 2, height * 2, defaultSize.width, defaultSize.height);
  const aspect = width > 0 && height > 0 ? width / height : 1;

  const updateSize = (nextWidth: number, nextHeight: number, withHistory = false) => {
    pendingSizeRef.current = withHistory ? null : { width: nextWidth, height: nextHeight };
    onSizeChange(nextWidth, nextHeight, withHistory);
  };

  const beginSizeInteraction = () => {
    pendingSizeRef.current = null;
  };

  const commitPendingSize = () => {
    const pendingSize = pendingSizeRef.current;
    if (!pendingSize) return;
    pendingSizeRef.current = null;
    onSizeChange(pendingSize.width, pendingSize.height, true);
  };

  const handleWidthChange = (value: number, withHistory = false) => {
    const nextWidth = clampDimension(value, width);
    const nextHeight = dimensionsLinked ? clampDimension(nextWidth / aspect, height) : height;
    updateSize(nextWidth, nextHeight, withHistory);
  };

  const handleHeightChange = (value: number, withHistory = false) => {
    const nextHeight = clampDimension(value, height);
    const nextWidth = dimensionsLinked ? clampDimension(nextHeight * aspect, width) : width;
    updateSize(nextWidth, nextHeight, withHistory);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <Slider
            label="Width"
            value={width}
            min={1}
            max={sliderMax}
            step={1}
            onChange={handleWidthChange}
            onInteractionStart={beginSizeInteraction}
            onInteractionEnd={commitPendingSize}
            onReset={() =>
              updateSize(defaultSize.width, dimensionsLinked ? defaultSize.height : height, true)
            }
            displayFormatter={formatPixels}
          />
        </div>
        <button
          type="button"
          onClick={() => setDimensionsLinked(!dimensionsLinked)}
          className={`mt-6 shrink-0 rounded p-1 transition ${
            dimensionsLinked
              ? 'text-primary-400 hover:text-primary-300'
              : 'text-gray-600 hover:text-gray-400'
          }`}
          title={dimensionsLinked ? 'Unlink dimensions' : 'Link dimensions'}
        >
          <Link className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <Slider
            label="Height"
            value={height}
            min={1}
            max={sliderMax}
            step={1}
            onChange={handleHeightChange}
            onInteractionStart={beginSizeInteraction}
            onInteractionEnd={commitPendingSize}
            onReset={() =>
              updateSize(dimensionsLinked ? defaultSize.width : width, defaultSize.height, true)
            }
            displayFormatter={formatPixels}
          />
        </div>
      </div>
      <SettingRow label="Fit Mode">
        <SegmentedControl
          options={REFORMAT_MODE_OPTIONS}
          value={mode}
          onChange={(value) => onModeChange(value as ReformatResizeMode)}
          className="w-full"
        />
      </SettingRow>
    </div>
  );
}

export function ReformatAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as ReformatNode;
  const { updateNode } = useEditorActions();
  const sceneNode = useEditorSelector((state) =>
    state.nodes.find((candidate): candidate is SceneNode => candidate.type === NodeType.SCENE),
  );
  const defaultSize = {
    width: sceneNode?.width ?? node.width,
    height: sceneNode?.height ?? node.height,
  };

  return (
    <>
      <CollapsibleSection title="Format" defaultOpen>
        <div className="space-y-4">
          <SizeControls
            width={node.width}
            height={node.height}
            defaultSize={defaultSize}
            mode={node.resizeMode}
            onSizeChange={(width, height, withHistory) =>
              updateNode(node.id, { width, height }, withHistory)
            }
            onModeChange={(resizeMode) => updateNode(node.id, { resizeMode }, true)}
          />
          <ResamplingControl
            value={node.resampling}
            onChange={(resampling) => updateNode(node.id, { resampling }, true)}
          />
        </div>
      </CollapsibleSection>
      <ShaderCodeButton title={`${node.name} GLSL Code`} code={SpatialShader.REFORMAT} />
    </>
  );
}
