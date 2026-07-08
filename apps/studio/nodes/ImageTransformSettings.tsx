import { useEffect, useState } from 'react';
import { ImageFitMode } from '@blackboard/types';
import { Link } from '@blackboard/icons';
import { Badge, CollapsibleSection } from '@blackboard/ui';
import { SegmentedControl, Slider } from '@/components';
import { IMAGE_FIT_MODE_OPTIONS, isCustomImageFitMode } from './imageFitMode';

export interface LinkedScaleUpdate {
  axis: 'x' | 'y';
  scaleX: number;
  scaleY: number;
  linked: boolean;
}

interface ImageTransformSettingsProps {
  fitMode: ImageFitMode;
  scaleX: number;
  scaleY: number;
  sceneSizeLabel: string;
  outputSizeLabel: string;
  useOutputSizeAsScene: boolean;
  scaleXKeyframed?: boolean;
  scaleYKeyframed?: boolean;
  positionX?: number;
  positionY?: number;
  positionXKeyframed?: boolean;
  positionYKeyframed?: boolean;
  positionRange?: { x: number; y: number };
  onFitModeChange: (fitMode: ImageFitMode) => void;
  onUseOutputSizeAsSceneChange: (checked: boolean) => void;
  onScaleChange: (update: LinkedScaleUpdate) => void;
  onScaleReset: (update: LinkedScaleUpdate) => void;
  onToggleScaleXKeyframe: () => void;
  onToggleScaleYKeyframe: () => void;
  onPositionChange?: (axis: 'x' | 'y', value: number) => void;
  onPositionReset?: (axis: 'x' | 'y') => void;
  onTogglePositionXKeyframe?: () => void;
  onTogglePositionYKeyframe?: () => void;
}

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;
const formatPixels = (value: number) => `${Math.round(value)} px`;

function SceneSizeModeControl({
  sceneSizeLabel,
  outputSizeLabel,
  useOutputSizeAsScene,
  onChange,
}: Pick<
  ImageTransformSettingsProps,
  'sceneSizeLabel' | 'outputSizeLabel' | 'useOutputSizeAsScene'
> & {
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-gray-400">Scene Size</label>
      <SegmentedControl
        ariaLabel="Scene size mode"
        value={useOutputSizeAsScene ? 'output' : 'scene'}
        options={[
          {
            value: 'scene',
            label: 'Keep Scene',
            description: sceneSizeLabel,
            ariaLabel: `Keep Scene, ${sceneSizeLabel}`,
          },
          {
            value: 'output',
            label: 'Match Output',
            description: outputSizeLabel,
            ariaLabel: `Match Output, ${outputSizeLabel}`,
          },
        ]}
        onChange={(value) => onChange(value === 'output')}
      />
    </div>
  );
}

export function ImageTransformSettings({
  fitMode,
  scaleX,
  scaleY,
  sceneSizeLabel,
  outputSizeLabel,
  useOutputSizeAsScene,
  scaleXKeyframed = false,
  scaleYKeyframed = false,
  positionX,
  positionY,
  positionXKeyframed = false,
  positionYKeyframed = false,
  positionRange = { x: 4000, y: 4000 },
  onFitModeChange,
  onUseOutputSizeAsSceneChange,
  onScaleChange,
  onScaleReset,
  onToggleScaleXKeyframe,
  onToggleScaleYKeyframe,
  onPositionChange,
  onPositionReset,
  onTogglePositionXKeyframe,
  onTogglePositionYKeyframe,
}: ImageTransformSettingsProps) {
  const [scaleLinked, setScaleLinked] = useState(() => fitMode !== ImageFitMode.STRETCH);
  const isCustomFitMode = isCustomImageFitMode(fitMode);
  const disabledClassName = useOutputSizeAsScene ? 'opacity-45' : '';
  const disabledInteractionClassName = useOutputSizeAsScene ? 'pointer-events-none' : undefined;

  useEffect(() => {
    if (isCustomFitMode) return;
    setScaleLinked(fitMode !== ImageFitMode.STRETCH);
  }, [fitMode, isCustomFitMode]);

  const handleFitModeChange = (value: string | number) => {
    if (useOutputSizeAsScene) return;
    const nextFitMode = value as ImageFitMode;
    onFitModeChange(nextFitMode);
    setScaleLinked(nextFitMode !== ImageFitMode.STRETCH);
  };

  const createScaleUpdate = (axis: 'x' | 'y', value: number): LinkedScaleUpdate => ({
    axis,
    scaleX: axis === 'x' || scaleLinked ? value : scaleX,
    scaleY: axis === 'y' || scaleLinked ? value : scaleY,
    linked: scaleLinked,
  });

  return (
    <CollapsibleSection title="Transform" defaultOpen>
      <div className="space-y-4">
        <SceneSizeModeControl
          sceneSizeLabel={sceneSizeLabel}
          outputSizeLabel={outputSizeLabel}
          useOutputSizeAsScene={useOutputSizeAsScene}
          onChange={onUseOutputSizeAsSceneChange}
        />

        <div className={`space-y-2 ${disabledClassName}`}>
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-medium text-gray-400">Fit Mode</label>
            {isCustomFitMode ? (
              <Badge size="sm" variant="accent" uppercase>
                Custom
              </Badge>
            ) : null}
          </div>
          <div className={disabledInteractionClassName}>
            <SegmentedControl
              value={fitMode}
              options={IMAGE_FIT_MODE_OPTIONS}
              onChange={handleFitModeChange}
            />
          </div>
        </div>

        <div className={`flex items-center gap-3 ${disabledClassName}`}>
          <div className={`min-w-0 flex-1 ${disabledInteractionClassName ?? ''}`}>
            <Slider
              label="Scale X"
              value={scaleX}
              min={0.01}
              max={5}
              step={0.01}
              onChange={(value) => onScaleChange(createScaleUpdate('x', value))}
              onReset={() => onScaleReset(createScaleUpdate('x', 1))}
              displayFormatter={formatPercent}
              isKeyframed={scaleXKeyframed}
              onToggleKeyframe={onToggleScaleXKeyframe}
            />
          </div>
          <button
            type="button"
            disabled={useOutputSizeAsScene}
            onClick={() => setScaleLinked(!scaleLinked)}
            className={`mt-6 shrink-0 rounded p-1 transition ${
              scaleLinked
                ? 'text-primary-400 hover:text-primary-300'
                : 'text-gray-600 hover:text-gray-400'
            } disabled:cursor-not-allowed`}
            title={scaleLinked ? 'Unlink scale axes' : 'Link scale axes'}
          >
            <Link className="h-4 w-4" />
          </button>
          <div className={`min-w-0 flex-1 ${disabledInteractionClassName ?? ''}`}>
            <Slider
              label="Scale Y"
              value={scaleY}
              min={0.01}
              max={5}
              step={0.01}
              onChange={(value) => onScaleChange(createScaleUpdate('y', value))}
              onReset={() => onScaleReset(createScaleUpdate('y', 1))}
              displayFormatter={formatPercent}
              isKeyframed={scaleYKeyframed}
              onToggleKeyframe={onToggleScaleYKeyframe}
            />
          </div>
        </div>

        {positionX !== undefined &&
        positionY !== undefined &&
        onPositionChange &&
        onPositionReset ? (
          <div className={`grid grid-cols-2 gap-3 ${disabledClassName}`}>
            <div className={disabledInteractionClassName}>
              <Slider
                label="Offset X"
                value={positionX}
                min={-positionRange.x}
                max={positionRange.x}
                step={1}
                onChange={(value) => onPositionChange('x', value)}
                onReset={() => onPositionReset('x')}
                displayFormatter={formatPixels}
                isKeyframed={positionXKeyframed}
                onToggleKeyframe={onTogglePositionXKeyframe}
              />
            </div>
            <div className={disabledInteractionClassName}>
              <Slider
                label="Offset Y"
                value={positionY}
                min={-positionRange.y}
                max={positionRange.y}
                step={1}
                onChange={(value) => onPositionChange('y', value)}
                onReset={() => onPositionReset('y')}
                displayFormatter={formatPixels}
                isKeyframed={positionYKeyframed}
                onToggleKeyframe={onTogglePositionYKeyframe}
              />
            </div>
          </div>
        ) : null}
      </div>
    </CollapsibleSection>
  );
}
