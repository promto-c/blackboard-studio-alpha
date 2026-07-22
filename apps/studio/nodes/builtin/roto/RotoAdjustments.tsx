import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import {
  AnyNode,
  RotoAlphaMode,
  RotoDrawMode,
  RotoLayer,
  RotoNode,
  RotoPath,
  RotoPathBlend,
  RotoShapeType,
  type RotoTrackingTransform,
  type RotoMotionBlurPhase,
  type RotoMotionBlurSettings,
} from '@blackboard/types';
import { Badge, CollapsibleSection, Slider } from '@blackboard/ui';
import * as Icons from '@blackboard/icons';
import { SegmentedControl, SettingRow, ToggleSettingRow } from '@/components';
import { getValueAtFrame, hasKeyframeAt, setKeyframeOnValue } from '@blackboard/renderer';
import { DEFAULT_ROTO_MOTION_BLUR, resolveRotoMotionBlurSettings } from '@/utils/rotoMotionBlur';
import {
  createIdentityRotoTrackingMatrix4,
  keyframeRotoTrackingMatrix4,
} from '@/utils/rotoTracking';

function TrackingMatrixSection({
  transform,
  currentFrame,
}: {
  transform: RotoTrackingTransform;
  currentFrame: number;
}) {
  const resolvedMatrix = transform.matrix.map((row) =>
    row.map((value) => getValueAtFrame(value, currentFrame)),
  );

  return (
    <CollapsibleSection title="Auto Track Matrix" defaultOpen={false}>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[10px] text-gray-400">
          <span>Model</span>
          <Badge
            size="sm"
            uppercase
            variant="neutral"
            className="!border-gray-700 !bg-gray-900 font-mono"
          >
            {transform.model}
          </Badge>
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
}

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

function UserTransformSection({
  transform,
  currentFrame,
  onUpdate,
}: {
  transform: RotoTrackingTransform | undefined;
  currentFrame: number;
  onUpdate: (transform: RotoTrackingTransform) => void;
}) {
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
}

type InspectorTarget = 'node' | 'shape' | 'layer';

interface RotoAdjustmentsProps {
  node: AnyNode;
  inspectorLevel?: InspectorTarget;
  onInspectorLevelChange?: (level: InspectorTarget) => void;
}

function RotoAdjustments({
  node: anyNode,
  inspectorLevel,
  onInspectorLevelChange,
}: RotoAdjustmentsProps) {
  const node = anyNode as RotoNode;
  const selectedRotoPathIds = useEditorSelector(
    (s) => s.hierarchySelections[s.selectedNodeId ?? '']?.itemIds ?? [],
  );
  const selectedRotoLayerIds = useEditorSelector(
    (s) => s.hierarchySelections[s.selectedNodeId ?? '']?.layerIds ?? [],
  );
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const { updateNode, setKeyframe, startRotoRefinement } = useEditorActions();
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

  // --- batch multi-item editing ---
  const selectedPathIdSet = useMemo(() => new Set(selectedRotoPathIds), [selectedRotoPathIds]);
  const selectedLayerIdSet = useMemo(() => new Set(selectedRotoLayerIds), [selectedRotoLayerIds]);

  const hasMultiPathSelection = selectedRotoPathIds.length > 1;
  const hasMultiLayerSelection = selectedRotoLayerIds.length > 1;
  const hasMultiSelection =
    hasMultiPathSelection ||
    hasMultiLayerSelection ||
    (selectedRotoPathIds.length > 0 && selectedRotoLayerIds.length > 0);
  const selectedItemCount = selectedRotoPathIds.length + selectedRotoLayerIds.length;
  const hasPathsSelected = selectedRotoPathIds.length > 0;
  const hasLayersSelected = selectedRotoLayerIds.length > 0;

  const selectedPaths = useMemo(
    () => node.paths.filter((p) => selectedPathIdSet.has(p.id)),
    [node.paths, selectedPathIdSet],
  );
  const selectedLayers = useMemo(
    () => (node.layers ?? []).filter((l) => selectedLayerIdSet.has(l.id)),
    [node.layers, selectedLayerIdSet],
  );

  function isItemsMixed<T, V>(items: T[], getValue: (item: T) => V): boolean {
    if (items.length <= 1) return false;
    const first = getValue(items[0]);
    return !items.every((item) => getValue(item) === first);
  }

  const batchUpdatePaths = useCallback(
    (updates: Partial<RotoPath>) => {
      const newPaths = node.paths.map((p) =>
        selectedPathIdSet.has(p.id) ? { ...p, ...updates } : p,
      );
      updateNode(node.id, { paths: newPaths }, true);
    },
    [node.id, node.paths, selectedPathIdSet, updateNode],
  );

  const batchUpdatePathsStyle = useCallback(
    (styleUpdates: Partial<RotoPath['style']>) => {
      const newPaths = node.paths.map((p) =>
        selectedPathIdSet.has(p.id) ? { ...p, style: { ...p.style, ...styleUpdates } } : p,
      );
      updateNode(node.id, { paths: newPaths }, true);
    },
    [node.id, node.paths, selectedPathIdSet, updateNode],
  );

  const batchUpdateLayers = useCallback(
    (updates: Partial<RotoLayer>) => {
      const newLayers = (node.layers ?? []).map((l) =>
        selectedLayerIdSet.has(l.id) ? { ...l, ...updates } : l,
      );
      updateNode(node.id, { layers: newLayers }, true);
    },
    [node.id, node.layers, selectedLayerIdSet, updateNode],
  );

  function MixedBadge() {
    return (
      <Badge size="sm" uppercase shrink noBorder className="!bg-yellow-500/15 !text-yellow-400">
        Mixed
      </Badge>
    );
  }

  // --- end batch ---

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

  const alphaModeOptions = [
    { value: RotoAlphaMode.ADD, label: 'Use as Base' },
    { value: RotoAlphaMode.REPLACE, label: 'Ignore' },
    { value: RotoAlphaMode.MULTIPLY, label: 'Multiply' },
  ];

  const shutterPhaseOptions = [
    { value: 'start', label: 'Start' },
    { value: 'centered', label: 'Centered' },
    { value: 'end', label: 'End' },
  ];

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
        <SettingRow label="Draw Mode">
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
            className="w-full"
          />
        </SettingRow>
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
        <SettingRow label="Blend Mode">
          <SegmentedControl
            value={selectedPath.blend}
            options={blendOptions}
            onChange={(value) =>
              updateSinglePath(selectedPath.id, {
                blend: value as RotoPathBlend,
              })
            }
            className="w-full"
          />
        </SettingRow>
        {selectedPath.sourceMask && (
          <div className="rounded-md border border-sky-400/15 bg-sky-400/[0.06] p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-100">
                  Smart Mask Source
                </div>
                <div className="mt-0.5 text-[9px] text-gray-500">
                  Frame {selectedPath.sourceMask.sourceFrame}
                  {selectedPath.sourceMask.confidence != null
                    ? ` · ${Math.round(selectedPath.sourceMask.confidence * 100)}% confidence`
                    : ''}
                </div>
              </div>
              <Icons.Sparkles className="h-4 w-4 text-sky-300" />
            </div>
            <p className="mt-2 text-[9px] leading-4 text-gray-400">
              The original raster mask is retained with this path for non-destructive contour work.
            </p>
            <button
              type="button"
              disabled={!selectedPath.originalPoints?.length}
              onClick={() =>
                selectedPath.originalPoints?.length &&
                startRotoRefinement({
                  name: selectedPath.name,
                  originalPoints: selectedPath.originalPoints,
                  epsilon: selectedPath.epsilon ?? 2,
                  closed: true,
                  targetPathId: selectedPath.id,
                })
              }
              className="mt-2 w-full rounded border border-sky-400/20 bg-sky-500/10 py-1.5 text-[10px] font-medium text-sky-100 hover:bg-sky-500/20 disabled:opacity-40"
            >
              Refine contour
            </button>
          </div>
        )}
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
        <SettingRow label="Blend Mode">
          <SegmentedControl
            value={selectedLayer?.blend ?? RotoPathBlend.ADD}
            options={blendOptions}
            onChange={(value) =>
              selectedLayerId &&
              updateSingleLayer(selectedLayerId, {
                blend: value as RotoPathBlend,
              })
            }
            className="w-full"
          />
        </SettingRow>
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
  ) : hasMultiSelection ? (
    <CollapsibleSection title={`Editing ${selectedItemCount} Items`} key="batch-items" defaultOpen>
      <div className="animate-[fadeIn_250ms_ease-out] space-y-3">
        {hasPathsSelected && (
          <>
            <SettingRow
              label="Draw Mode"
              labelAccessory={
                isItemsMixed(selectedPaths, (p: RotoPath) => p.style.mode) ? <MixedBadge /> : null
              }
            >
              <SegmentedControl
                value={selectedPaths[0]?.style.mode ?? RotoDrawMode.FILL}
                options={drawModeOptions}
                onChange={(value) => batchUpdatePathsStyle({ mode: value as RotoDrawMode })}
                className="w-full"
              />
            </SettingRow>
            <div className="flex items-center gap-1.5">
              {isItemsMixed(selectedPaths, (p: RotoPath) =>
                getValueAtFrame(p.style.strokeWidth, currentFrame),
              ) && <MixedBadge />}
              <div className="flex-1">
                <Slider
                  label="Stroke Width"
                  value={getValueAtFrame(selectedPaths[0]?.style.strokeWidth ?? 2, currentFrame)}
                  min={0}
                  max={100}
                  step={0.1}
                  onChange={(v) => batchUpdatePathsStyle({ strokeWidth: v })}
                  onReset={() => batchUpdatePathsStyle({ strokeWidth: 2 })}
                  displayFormatter={(v) => `${v.toFixed(1)}px`}
                />
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {isItemsMixed(selectedPaths, (p: RotoPath) =>
                getValueAtFrame(p.opacity, currentFrame),
              ) && <MixedBadge />}
              <div className="flex-1">
                <Slider
                  label="Opacity"
                  value={getValueAtFrame(selectedPaths[0]?.opacity ?? 100, currentFrame)}
                  min={0}
                  max={100}
                  step={1}
                  onChange={(v) => batchUpdatePaths({ opacity: v })}
                  onReset={() => batchUpdatePaths({ opacity: 100 })}
                  displayFormatter={(v) => `${v.toFixed(0)}%`}
                />
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {isItemsMixed(selectedPaths, (p: RotoPath) =>
                getValueAtFrame(p.feather, currentFrame),
              ) && <MixedBadge />}
              <div className="flex-1">
                <Slider
                  label="Feather"
                  value={getValueAtFrame(selectedPaths[0]?.feather ?? 0, currentFrame)}
                  min={0}
                  max={100}
                  step={0.1}
                  onChange={(v) => batchUpdatePaths({ feather: v })}
                  onReset={() => batchUpdatePaths({ feather: 0 })}
                  displayFormatter={(v) => `${v.toFixed(1)}px`}
                />
              </div>
            </div>
            <SettingRow
              label="Blend Mode"
              labelAccessory={
                isItemsMixed(selectedPaths, (p: RotoPath) => p.blend) ? <MixedBadge /> : null
              }
            >
              <SegmentedControl
                value={selectedPaths[0]?.blend ?? RotoPathBlend.ADD}
                options={blendOptions}
                onChange={(value) => batchUpdatePaths({ blend: value as RotoPathBlend })}
                className="w-full"
              />
            </SettingRow>
          </>
        )}
        {hasLayersSelected && (
          <SettingRow
            label="Layer Blend Mode"
            labelAccessory={
              isItemsMixed(selectedLayers, (l: RotoLayer) => l.blend ?? RotoPathBlend.ADD) ? (
                <MixedBadge />
              ) : null
            }
          >
            <SegmentedControl
              value={selectedLayers[0]?.blend ?? RotoPathBlend.ADD}
              options={blendOptions}
              onChange={(value) => batchUpdateLayers({ blend: value as RotoPathBlend })}
              className="w-full"
            />
          </SettingRow>
        )}
      </div>
    </CollapsibleSection>
  ) : (
    <CollapsibleSection title="Node Settings" defaultOpen>
      <div className="space-y-3">
        <ToggleSettingRow
          label="Invert Matte"
          checked={node.invert}
          onCheckedChange={(checked) => updateNode(node.id, { invert: checked }, true)}
        />
        <SettingRow label="Input Alpha Mode">
          <SegmentedControl
            value={node.alphaMode ?? RotoAlphaMode.ADD}
            options={alphaModeOptions}
            onChange={(value) => updateNode(node.id, { alphaMode: value as RotoAlphaMode }, true)}
            className="w-full"
          />
        </SettingRow>
        <ToggleSettingRow
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
          <SettingRow label="Shutter Offset" className="pt-1.5">
            <SegmentedControl
              value={motionBlur.phase}
              options={shutterPhaseOptions}
              onChange={(value) => updateMotionBlur({ phase: value as RotoMotionBlurPhase })}
              className="w-full"
            />
          </SettingRow>
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
}

export default RotoAdjustments;
