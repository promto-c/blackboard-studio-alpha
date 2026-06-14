import { useEffect, useState } from 'react';
import { ImageFitMode } from '@blackboard/types';
import { Link } from '@blackboard/icons';
import { CollapsibleSection } from '@blackboard/ui';
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
  onFitModeChange: (fitMode: ImageFitMode) => void;
  onUseOutputSizeAsSceneChange: (checked: boolean) => void;
  onScaleChange: (update: LinkedScaleUpdate) => void;
  onScaleReset: (update: LinkedScaleUpdate) => void;
  onToggleScaleXKeyframe: () => void;
  onToggleScaleYKeyframe: () => void;
}

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

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
      <div
        role="radiogroup"
        aria-label="Scene size mode"
        className="grid grid-cols-2 gap-1 rounded-lg bg-gray-900 p-1 text-left text-xs"
      >
        <button
          type="button"
          role="radio"
          aria-checked={!useOutputSizeAsScene}
          onClick={() => onChange(false)}
          className={`min-w-0 rounded-md px-2 py-2 transition-colors duration-200 ease-in-out ${
            !useOutputSizeAsScene
              ? 'bg-gray-700 text-white shadow'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <span className="block truncate font-medium">Keep Scene</span>
          <span className="mt-0.5 block truncate font-mono text-[11px] text-gray-500">
            {sceneSizeLabel}
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={useOutputSizeAsScene}
          onClick={() => onChange(true)}
          className={`min-w-0 rounded-md px-2 py-2 transition-colors duration-200 ease-in-out ${
            useOutputSizeAsScene
              ? 'bg-gray-700 text-white shadow'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <span className="block truncate font-medium">Match Output</span>
          <span className="mt-0.5 block truncate font-mono text-[11px] text-gray-500">
            {outputSizeLabel}
          </span>
        </button>
      </div>
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
  onFitModeChange,
  onUseOutputSizeAsSceneChange,
  onScaleChange,
  onScaleReset,
  onToggleScaleXKeyframe,
  onToggleScaleYKeyframe,
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
              <span className="rounded border border-primary-300/20 bg-primary-300/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-primary-100">
                Custom
              </span>
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
      </div>
    </CollapsibleSection>
  );
}
