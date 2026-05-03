import React, { useCallback, useEffect, useState } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import {
  AnyNode,
  RotoDrawMode,
  RotoNode,
  RotoPath,
  RotoPathBlend,
  RotoShapeType,
  type RotoTrackingTransform,
  type RotoMotionBlurPhase,
  type RotoMotionBlurSettings,
} from '@blackboard/types';
import { CollapsibleSection, Slider, SegmentedControl, ToggleSwitch } from '@/components';
import { getValueAtFrame, hasKeyframeAt, setKeyframeOnValue } from '@blackboard/renderer';
import { DEFAULT_ROTO_MOTION_BLUR, resolveRotoMotionBlurSettings } from '@/utils/rotoMotionBlur';
import {
  createIdentityRotoTrackingMatrix4,
  keyframeRotoTrackingMatrix4,
} from '@/utils/rotoTracking';

const TrackingMatrixSection: React.FC<{
  transform: RotoTrackingTransform;
  currentFrame: number;
}> = ({ transform, currentFrame }) => {
  const resolvedMatrix = transform.matrix.map((row) =>
    row.map((value) => getValueAtFrame(value, currentFrame)),
  );

  return (
    <CollapsibleSection title="Auto Track Matrix" defaultOpen={false}>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[10px] text-gray-400">
          <span>Model</span>
          <span className="rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 font-mono uppercase text-gray-200">
            {transform.model}
          </span>
        </div>
        <div className="text-[10px] text-gray-500">
          Source Shapes: {transform.sourcePathIds.length}
        </div>
        <div className="grid grid-cols-4 gap-1 font-mono text-[10px]">
          {resolvedMatrix.flatMap((row, rowIndex) =>
            row.map((value, columnIndex) => (
              <div
                key={`${rowIndex}-${columnIndex}`}
                className="rounded border border-gray-700 bg-gray-900/70 px-1.5 py-1 text-right text-gray-200"
              >
                {value.toFixed(4)}
              </div>
            )),
          )}
        </div>
      </div>
    </CollapsibleSection>
  );
};

const createDefaultUserTransform = (): RotoTrackingTransform => ({
  matrix: createIdentityRotoTrackingMatrix4(),
  model: 'translation',
  sourcePathIds: [],
});

const ensureUserTransform = (existing: RotoTrackingTransform | undefined): RotoTrackingTransform =>
  existing ?? createDefaultUserTransform();

const hasUserTransformKeyframeAt = (
  transform: RotoTrackingTransform | undefined,
  frame: number,
): boolean => !!transform?.matrix?.some((row) => row.some((value) => hasKeyframeAt(value, frame)));

const toggleUserTransformKeyframe = (
  transform: RotoTrackingTransform | undefined,
  frame: number,
): RotoTrackingTransform => {
  const base = ensureUserTransform(transform);
  const shouldRemove = hasUserTransformKeyframeAt(transform, frame);
  const resolvedMatrix = base.matrix.map((row) =>
    row.map((value) => getValueAtFrame(value, frame)),
  );

  return {
    ...base,
    matrix: base.matrix.map((row, rowIndex) =>
      row.map((value, columnIndex) => {
        if (shouldRemove) {
          return hasKeyframeAt(value, frame) ? setKeyframeOnValue(value, frame) : value;
        }
        return setKeyframeOnValue(
          value,
          frame,
          resolvedMatrix[rowIndex]?.[columnIndex] ?? (rowIndex === columnIndex ? 1 : 0),
        );
      }),
    ),
  };
};

const decomposeUserTransform = (transform: RotoTrackingTransform | undefined, frame: number) => {
  if (!transform) {
    return { tx: 0, ty: 0, sx: 1, sy: 1, rotation: 0 };
  }
  const m = transform.matrix;
  const a = getValueAtFrame(m[0][0], frame);
  const b = getValueAtFrame(m[1][0], frame);
  const c = getValueAtFrame(m[0][1], frame);
  const d = getValueAtFrame(m[1][1], frame);
  const tx = getValueAtFrame(m[0][3], frame);
  const ty = getValueAtFrame(m[1][3], frame);
  const sx = Math.hypot(a, b);
  const sy = Math.hypot(c, d);
  const rotation = Math.atan2(b, a);
  return { tx, ty, sx, sy, rotation };
};

const composeUserTransformMatrix = (
  tx: number,
  ty: number,
  sx: number,
  sy: number,
  rotation: number,
): number[][] => {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [
    [cos * sx, -sin * sy, 0, tx],
    [sin * sx, cos * sy, 0, ty],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
};

const UserTransformSection: React.FC<{
  transform: RotoTrackingTransform | undefined;
  currentFrame: number;
  onUpdate: (transform: RotoTrackingTransform) => void;
}> = ({ transform, currentFrame, onUpdate }) => {
  const { tx, ty, sx, sy, rotation } = decomposeUserTransform(transform, currentFrame);
  const [lockAspect, setLockAspect] = useState(true);
  const rotDeg = (rotation * 180) / Math.PI;
  const isKeyframed = hasUserTransformKeyframeAt(transform, currentFrame);

  const handleChange = (field: 'tx' | 'ty' | 'sx' | 'sy' | 'rotation', value: number) => {
    let newTx = tx,
      newTy = ty,
      newSx = sx,
      newSy = sy,
      newRot = rotation;
    switch (field) {
      case 'tx':
        newTx = value;
        break;
      case 'ty':
        newTy = value;
        break;
      case 'sx':
        newSx = value;
        if (lockAspect) newSy = sx !== 0 ? (sy / sx) * value : value;
        break;
      case 'sy':
        newSy = value;
        if (lockAspect) newSx = sy !== 0 ? (sx / sy) * value : value;
        break;
      case 'rotation':
        newRot = (value * Math.PI) / 180;
        break;
    }

    const resolvedMatrix = composeUserTransformMatrix(newTx, newTy, newSx, newSy, newRot);
    const base = ensureUserTransform(transform);
    onUpdate({
      ...base,
      matrix: keyframeRotoTrackingMatrix4(base.matrix, currentFrame, resolvedMatrix),
    });
  };

  const handleToggleKeyframe = () => {
    onUpdate(toggleUserTransformKeyframe(transform, currentFrame));
  };

  const handleReset = () => {
    onUpdate(createDefaultUserTransform());
  };

  return (
    <CollapsibleSection title="User Transform" defaultOpen>
      <div className="space-y-2">
        <Slider
          label="Translate X"
          value={tx}
          min={-2000}
          max={2000}
          step={0.1}
          onChange={(v) => handleChange('tx', v)}
          onReset={() => handleChange('tx', 0)}
          displayFormatter={(v) => `${v.toFixed(1)}`}
          isKeyframed={isKeyframed}
          onToggleKeyframe={handleToggleKeyframe}
        />
        <Slider
          label="Translate Y"
          value={ty}
          min={-2000}
          max={2000}
          step={0.1}
          onChange={(v) => handleChange('ty', v)}
          onReset={() => handleChange('ty', 0)}
          displayFormatter={(v) => `${v.toFixed(1)}`}
          isKeyframed={isKeyframed}
          onToggleKeyframe={handleToggleKeyframe}
        />
        <div className="flex items-center gap-1.5">
          <div className="flex-1">
            <Slider
              label="Scale X"
              value={sx}
              min={0.01}
              max={10}
              step={0.01}
              onChange={(v) => handleChange('sx', v)}
              onReset={() => handleChange('sx', 1)}
              displayFormatter={(v) => `${(v * 100).toFixed(0)}%`}
              isKeyframed={isKeyframed}
              onToggleKeyframe={handleToggleKeyframe}
            />
          </div>
          <button
            onClick={() => setLockAspect(!lockAspect)}
            className={`mt-3 p-1.5 rounded transition-colors ${
              lockAspect
                ? 'text-primary-400 bg-primary-500/10'
                : 'text-gray-500 hover:text-gray-300'
            }`}
            title={lockAspect ? 'Aspect locked' : 'Aspect unlocked'}
          >
            <svg viewBox="0 0 16 16" className="w-3 h-3" fill="currentColor">
              {lockAspect ? (
                <path d="M8 1a4 4 0 0 0-4 4v3H3a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-1V5a4 4 0 0 0-4-4zm2 7H6V5a2 2 0 1 1 4 0v3z" />
              ) : (
                <path d="M8 1a4 4 0 0 0-4 4v1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H6V5a2 2 0 1 1 4 0h2a4 4 0 0 0-4-4z" />
              )}
            </svg>
          </button>
        </div>
        <Slider
          label="Scale Y"
          value={sy}
          min={0.01}
          max={10}
          step={0.01}
          onChange={(v) => handleChange('sy', v)}
          onReset={() => handleChange('sy', 1)}
          displayFormatter={(v) => `${(v * 100).toFixed(0)}%`}
          isKeyframed={isKeyframed}
          onToggleKeyframe={handleToggleKeyframe}
        />
        <Slider
          label="Rotation"
          value={rotDeg}
          min={-180}
          max={180}
          step={0.1}
          onChange={(v) => handleChange('rotation', v)}
          onReset={() => handleChange('rotation', 0)}
          isKeyframed={isKeyframed}
          onToggleKeyframe={handleToggleKeyframe}
          displayFormatter={(v) => `${v.toFixed(1)}°`}
        />
        <button
          onClick={handleReset}
          className="w-full text-center text-[10px] py-1 text-gray-500 hover:text-gray-300 transition-colors"
        >
          Reset Transform
        </button>
      </div>
    </CollapsibleSection>
  );
};

type InspectorTarget = 'node' | 'shape' | 'layer';

interface RotoAdjustmentsProps {
  node: AnyNode;
  inspectorLevel?: InspectorTarget;
  onInspectorLevelChange?: (level: InspectorTarget) => void;
}

const RotoAdjustments: React.FC<RotoAdjustmentsProps> = ({
  node: anyNode,
  inspectorLevel,
  onInspectorLevelChange,
}) => {
  const node = anyNode as RotoNode;
  const selectedRotoPathIds = useEditorSelector((s) => s.selectedRotoPathIds);
  const selectedRotoLayerIds = useEditorSelector((s) => s.selectedRotoLayerIds);
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const { updateNode, setKeyframe } = useEditorActions();
  const [inspectorTarget, setInspectorTarget] = useState<InspectorTarget>(inspectorLevel ?? 'node');
  const motionBlur = resolveRotoMotionBlurSettings(node.motionBlur);

  const selectedPathId = selectedRotoPathIds.length > 0 ? selectedRotoPathIds[0] : null;
  const selectedPath = selectedPathId ? node.paths.find((p) => p.id === selectedPathId) : null;
  const selectedPathIndex = selectedPathId
    ? node.paths.findIndex((p) => p.id === selectedPathId)
    : -1;

  const selectedLayerId = selectedRotoLayerIds.length === 1 ? selectedRotoLayerIds[0] : null;
  const selectedLayer =
    selectedLayerId && Array.isArray(node.layers)
      ? node.layers.find((layer) => layer.id === selectedLayerId)
      : null;
  const selectedLayerIndex =
    selectedLayerId && Array.isArray(node.layers)
      ? node.layers.findIndex((layer) => layer.id === selectedLayerId)
      : -1;
  const setInspectorTargetLevel = useCallback(
    (level: InspectorTarget) => {
      setInspectorTarget(level);
      onInspectorLevelChange?.(level);
    },
    [onInspectorLevelChange],
  );

  useEffect(() => {
    if (inspectorLevel) {
      setInspectorTarget(inspectorLevel);
    }
  }, [inspectorLevel]);

  useEffect(() => {
    if (!selectedPath && !selectedLayer) {
      setInspectorTargetLevel('node');
    } else if (!selectedPath && selectedLayer) {
      setInspectorTargetLevel('layer');
    }
  }, [selectedLayer, selectedPath, setInspectorTargetLevel]);

  const updateMotionBlur = (updates: Partial<RotoMotionBlurSettings>) => {
    updateNode(
      node.id,
      { motionBlur: resolveRotoMotionBlurSettings({ ...motionBlur, ...updates }) },
      true,
    );
  };

  const updateSinglePath = (
    pathId: string,
    updates: Partial<RotoPath>,
    withHistory: boolean = true,
  ) => {
    const newPaths = node.paths.map((p) => (p.id === pathId ? { ...p, ...updates } : p));
    updateNode(node.id, { paths: newPaths }, withHistory);
  };

  const updateSingleLayer = (
    layerId: string,
    updates: Partial<NonNullable<typeof node.layers>[number]>,
    withHistory: boolean = true,
  ) => {
    const nextLayers = (node.layers ?? []).map((layer) =>
      layer.id === layerId ? { ...layer, ...updates } : layer,
    );
    updateNode(node.id, { layers: nextLayers }, withHistory);
  };

  const blendOptions = [
    { value: RotoPathBlend.ADD, label: 'Add' },
    { value: RotoPathBlend.SUBTRACT, label: 'Subtract' },
  ];

  const drawModeOptions = [
    { value: RotoDrawMode.FILL, label: 'Fill' },
    { value: RotoDrawMode.STROKE, label: 'Stroke' },
    { value: RotoDrawMode.FILL_AND_STROKE, label: 'Both' },
  ];

  const shutterPhaseOptions = [
    { value: 'start', label: 'Start' },
    { value: 'centered', label: 'Centered' },
    { value: 'end', label: 'End' },
  ] as const;

  const valuesAtFrame = selectedPath
    ? {
        opacity: getValueAtFrame(selectedPath.opacity, currentFrame),
        feather: getValueAtFrame(selectedPath.feather, currentFrame),
        strokeWidth: selectedPath.style
          ? getValueAtFrame(selectedPath.style.strokeWidth, currentFrame)
          : 2,
      }
    : null;
  const isShapeInspectorActive =
    inspectorTarget === 'shape' && selectedPath && valuesAtFrame && selectedPathIndex !== -1;
  const isLayerInspectorActive =
    inspectorTarget === 'layer' && selectedLayer && selectedLayerIndex !== -1;

  return isShapeInspectorActive ? (
    <CollapsibleSection key={selectedPath.id} title="Shape Settings" defaultOpen>
      <div className="animate-[fadeIn_250ms_ease-out] space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-400">Draw Mode</label>
          <SegmentedControl
            value={selectedPath.style.mode}
            options={drawModeOptions}
            onChange={(value) =>
              updateSinglePath(selectedPath.id, {
                style: {
                  ...selectedPath.style,
                  mode: value as RotoDrawMode,
                },
              })
            }
          />
        </div>
        {(selectedPath.style.mode === RotoDrawMode.STROKE ||
          selectedPath.style.mode === RotoDrawMode.FILL_AND_STROKE) && (
          <Slider
            label="Stroke Width"
            value={valuesAtFrame.strokeWidth}
            min={0}
            max={100}
            step={0.1}
            onChange={(v) =>
              setKeyframe(node.id, `paths[${selectedPathIndex}].style.strokeWidth`, v)
            }
            onReset={() =>
              setKeyframe(node.id, `paths[${selectedPathIndex}].style.strokeWidth`, 2, true)
            }
            displayFormatter={(v) => `${v.toFixed(1)}px`}
            isKeyframed={hasKeyframeAt(selectedPath.style.strokeWidth, currentFrame)}
            onToggleKeyframe={() =>
              setKeyframe(node.id, `paths[${selectedPathIndex}].style.strokeWidth`)
            }
          />
        )}
        <Slider
          label="Opacity"
          value={valuesAtFrame.opacity}
          min={0}
          max={100}
          step={1}
          onChange={(v) => setKeyframe(node.id, `paths[${selectedPathIndex}].opacity`, v)}
          onReset={() => setKeyframe(node.id, `paths[${selectedPathIndex}].opacity`, 100, true)}
          displayFormatter={(v) => `${v.toFixed(0)}%`}
          isKeyframed={hasKeyframeAt(selectedPath.opacity, currentFrame)}
          onToggleKeyframe={() => setKeyframe(node.id, `paths[${selectedPathIndex}].opacity`)}
        />
        <Slider
          label="Feather"
          value={valuesAtFrame.feather}
          min={0}
          max={100}
          step={0.1}
          onChange={(v) => setKeyframe(node.id, `paths[${selectedPathIndex}].feather`, v)}
          onReset={() => setKeyframe(node.id, `paths[${selectedPathIndex}].feather`, 0, true)}
          displayFormatter={(v) => `${v.toFixed(1)}px`}
          isKeyframed={hasKeyframeAt(selectedPath.feather, currentFrame)}
          onToggleKeyframe={() => setKeyframe(node.id, `paths[${selectedPathIndex}].feather`)}
        />
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-400">Blend Mode</label>
          <SegmentedControl
            value={selectedPath.blend}
            options={blendOptions}
            onChange={(value) =>
              updateSinglePath(selectedPath.id, {
                blend: value as RotoPathBlend,
              })
            }
          />
        </div>
        {!selectedPath.closed &&
          selectedPath.shapeType === RotoShapeType.BSPLINE &&
          selectedPath.points.length > 2 && (
            <div className="pt-1">
              <button
                onClick={() =>
                  updateSinglePath(selectedPath.id, {
                    closed: true,
                    style: {
                      ...selectedPath.style,
                      mode: RotoDrawMode.FILL,
                    },
                  })
                }
                className="w-full text-center text-xs py-1.5 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
              >
                Close Path
              </button>
            </div>
          )}
        {selectedPath.trackingTransform && (
          <TrackingMatrixSection
            transform={selectedPath.trackingTransform}
            currentFrame={currentFrame}
          />
        )}
        <UserTransformSection
          transform={selectedPath.userTransform}
          currentFrame={currentFrame}
          onUpdate={(userTransform) => updateSinglePath(selectedPath.id, { userTransform })}
        />
      </div>
    </CollapsibleSection>
  ) : isLayerInspectorActive ? (
    <CollapsibleSection key={selectedLayerId ?? 'layer'} title="Layer Settings" defaultOpen>
      <div className="animate-[fadeIn_250ms_ease-out] space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-400">Blend Mode</label>
          <SegmentedControl
            value={selectedLayer?.blend ?? RotoPathBlend.ADD}
            options={blendOptions}
            onChange={(value) =>
              selectedLayerId &&
              updateSingleLayer(selectedLayerId, {
                blend: value as RotoPathBlend,
              })
            }
          />
        </div>
        {selectedLayer?.trackingTransform && (
          <TrackingMatrixSection
            transform={selectedLayer.trackingTransform}
            currentFrame={currentFrame}
          />
        )}
        <UserTransformSection
          transform={selectedLayer?.userTransform}
          currentFrame={currentFrame}
          onUpdate={(userTransform) =>
            selectedLayerId && updateSingleLayer(selectedLayerId, { userTransform })
          }
        />
      </div>
    </CollapsibleSection>
  ) : (
    <CollapsibleSection title="Node Settings" defaultOpen>
      <div className="space-y-3">
        <ToggleSwitch
          label="Invert Matte"
          checked={node.invert}
          onCheckedChange={(checked) => updateNode(node.id, { invert: checked }, true)}
        />
        <ToggleSwitch
          label="Motion Blur"
          checked={motionBlur.enabled}
          onCheckedChange={(checked) => updateMotionBlur({ enabled: checked })}
        />
        <div className={motionBlur.enabled ? '' : 'opacity-60 pointer-events-none'}>
          <Slider
            label="Shutter"
            value={motionBlur.shutter}
            min={0}
            max={2}
            step={0.01}
            onChange={(value) => updateMotionBlur({ shutter: value })}
            onReset={() => updateMotionBlur({ shutter: DEFAULT_ROTO_MOTION_BLUR.shutter })}
            displayFormatter={(value) => `${value.toFixed(2)}f`}
          />
          <div className="pt-1.5 space-y-1.5">
            <label className="text-xs font-medium text-gray-400">Shutter Offset</label>
            <SegmentedControl
              value={motionBlur.phase}
              options={shutterPhaseOptions}
              onChange={(value) => updateMotionBlur({ phase: value as RotoMotionBlurPhase })}
            />
          </div>
          <div className="pt-1.5">
            <Slider
              label="Samples"
              value={motionBlur.samples}
              min={2}
              max={128}
              step={1}
              onChange={(value) => updateMotionBlur({ samples: Math.round(value) })}
              onReset={() => updateMotionBlur({ samples: DEFAULT_ROTO_MOTION_BLUR.samples })}
              displayFormatter={(value) => `${Math.round(value)}`}
            />
          </div>
        </div>
      </div>
    </CollapsibleSection>
  );
};

export default RotoAdjustments;
