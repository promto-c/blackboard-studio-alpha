import React, { useState, useMemo, useEffect } from 'react';
import { AnyNode, RotoNode, TrackingConfig } from '@blackboard/types';
import type { RotoMotionCueScope, RotoMotionCueMode } from '@blackboard/types';
import * as Icons from '@blackboard/icons';

import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { useMediaSourceSelection } from '@/hooks/useMediaSourceSelection';
import {
  ROTO_TRACKING_DRIFT_TOLERANCE_DEFAULT,
  ROTO_TRACKING_DRIFT_TOLERANCE_MAX,
  ROTO_TRACKING_DRIFT_TOLERANCE_MIN,
  usePreferences,
} from '@/state/preferencesContext';
import {
  MediaSourceSelect,
  Slider,
  SegmentedControl,
  ViewportToolPanel as Panel,
  ViewportToolPanelHeader as PanelHeader,
  ToggleButton,
} from '@/components';
import { toggleTransformWithHierarchy } from '@/utils/transformHierarchy';
import {
  isPendingRotoTrackingLayerTarget,
  resolveRotoTrackingSelection,
  type RotoTrackingTarget,
} from '@/utils/rotoTracking';
import { resolveRotoMotionBlurSettings } from '@/utils/rotoMotionBlur';

// ─── Nudge panel ───────────────────────────────────────────────────────────────

const NudgePanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { nudgeRadius, setPreferences } = usePreferences();
  return (
    <Panel width="w-44">
      <PanelHeader title="Nudge" onClose={onClose} />
      <p className="text-[10px] text-gray-400 text-center mb-1">Ctrl/Cmd + Drag to resize</p>
      <p className="text-[10px] text-gray-400 text-center mb-2">Shift for uniform strength</p>
      <Slider
        label="Radius"
        value={nudgeRadius}
        min={1}
        max={500}
        step={1}
        onChange={(r) => setPreferences({ nudgeRadius: Math.max(1, Math.min(500, r)) })}
        onReset={() => setPreferences({ nudgeRadius: 50 })}
        displayFormatter={(v) => `${v.toFixed(0)}px`}
      />
    </Panel>
  );
};

// ─── Auto-Trace panel ──────────────────────────────────────────────────────────

const AutoTracePanel: React.FC<{
  node: RotoNode;
  onClose: () => void;
}> = ({ node, onClose }) => {
  const nodes = useEditorSelector((s) => s.nodes);
  const selectedRotoPathIds = useEditorSelector((s) => s.selectedRotoPathIds);
  const { traceNodeContour } = useEditorActions();
  const {
    sourceId,
    setSourceId,
    options: availableSources,
  } = useMediaSourceSelection(nodes, node.id);
  const [channel, setChannel] = useState<'luma' | 'alpha'>('alpha');
  const [threshold, setThreshold] = useState(0.5);
  const [isTracing, setIsTracing] = useState(false);

  const selectedPathId = selectedRotoPathIds[0] ?? null;

  const handleTrace = async (asUpdate: boolean) => {
    if (!sourceId) return;
    setIsTracing(true);
    try {
      await traceNodeContour(
        node.id,
        sourceId,
        channel,
        threshold,
        asUpdate ? (selectedPathId ?? undefined) : undefined,
      );
    } finally {
      setIsTracing(false);
    }
  };

  return (
    <Panel>
      <PanelHeader title="Auto-Trace" onClose={onClose} />
      <div className="space-y-3">
        <MediaSourceSelect value={sourceId} options={availableSources} onChange={setSourceId} />

        <div className="space-y-1">
          <label className="text-[10px] text-gray-400 font-medium">Channel</label>
          <div className="flex bg-gray-800 rounded p-0.5 border border-gray-700">
            {(['alpha', 'luma'] as const).map((ch) => (
              <button
                key={ch}
                onClick={() => setChannel(ch)}
                className={`flex-1 text-[10px] py-1 rounded capitalize ${channel === ch ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                {ch}
              </button>
            ))}
          </div>
        </div>

        <Slider
          label="Threshold"
          value={threshold}
          min={0.01}
          max={0.99}
          step={0.01}
          onChange={setThreshold}
          displayFormatter={(v) => v.toFixed(2)}
        />

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => handleTrace(false)}
            disabled={!sourceId || isTracing}
            className="flex-1 py-1.5 text-xs bg-primary-600 hover:bg-primary-700 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isTracing ? '…' : 'Trace New'}
          </button>
          <button
            onClick={() => handleTrace(true)}
            disabled={!sourceId || isTracing || !selectedPathId}
            className="flex-1 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Update selected shape points"
          >
            Update
          </button>
        </div>
      </div>
    </Panel>
  );
};

// ─── Tracking panel ────────────────────────────────────────────────────────────

const TrackingSection: React.FC<{
  title: string;
  icon: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, meta, children }) => (
  <section className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-2.5">
    <div className="flex min-w-0 items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-semibold uppercase text-gray-400">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white/[0.04] text-gray-300">
          {icon}
        </span>
        <span className="truncate">{title}</span>
      </div>
      {meta}
    </div>
    {children}
  </section>
);

const TrackingPill: React.FC<{
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'warning' | 'danger';
}> = ({ children, tone = 'neutral' }) => {
  const toneClassName =
    tone === 'accent'
      ? 'border-primary-400/25 bg-primary-500/10 text-primary-100'
      : tone === 'warning'
        ? 'border-amber-300/25 bg-amber-300/10 text-amber-100'
        : tone === 'danger'
          ? 'border-red-300/25 bg-red-500/10 text-red-100'
          : 'border-white/10 bg-white/[0.04] text-gray-300';

  return (
    <span
      className={`inline-flex min-w-0 max-w-full items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${toneClassName}`}
    >
      <span className="truncate">{children}</span>
    </span>
  );
};

const TrackingActionButton: React.FC<{
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  title: string;
  variant?: 'primary' | 'secondary' | 'smart' | 'danger';
}> = ({ label, icon, onClick, disabled, title, variant = 'secondary' }) => {
  const variantClassName =
    variant === 'primary'
      ? 'border-primary-400/30 bg-primary-500/15 text-primary-50 hover:border-primary-300/45 hover:bg-primary-500/25'
      : variant === 'smart'
        ? 'border-purple-400/30 bg-purple-500/15 text-purple-100 hover:border-purple-300/45 hover:bg-purple-500/25'
        : variant === 'danger'
          ? 'border-red-400/30 bg-red-500/15 text-red-100 hover:border-red-300/45 hover:bg-red-500/25'
          : 'border-white/10 bg-white/[0.04] text-gray-300 hover:border-white/20 hover:bg-white/[0.07] hover:text-white';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex w-full min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${variantClassName}`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
};

const TrackingPanel: React.FC<{
  node: RotoNode;
  onClose: () => void;
}> = ({ node, onClose }) => {
  const nodes = useEditorSelector((s) => s.nodes);
  const selectedRotoLayerIds = useEditorSelector((s) => s.selectedRotoLayerIds);
  const selectedRotoPathIds = useEditorSelector((s) => s.selectedRotoPathIds);
  const { trackRotoSelection, smartTrackRotoSelection, clearRotoTrackingTarget, cancelTracking } =
    useEditorActions();
  const { rotoTrackingBackgroundEnabled, rotoTrackingDriftTolerance, setPreferences } =
    usePreferences();
  const {
    sourceId,
    setSourceId,
    options: availableSources,
  } = useMediaSourceSelection(nodes, node.id);
  const [isTracking, setIsTracking] = useState(false);
  const trackingScope = useMemo(
    () => resolveRotoTrackingSelection(node, selectedRotoLayerIds, selectedRotoPathIds),
    [node, selectedRotoLayerIds, selectedRotoPathIds],
  );
  const [motionModel, setMotionModel] = useState({
    translation: true,
    rotation: true,
    scale: true,
    affine: false,
    perspective: false,
  });
  const [trackDeform, setTrackDeform] = useState(false);
  const [targetKind, setTargetKind] = useState<'shape' | 'layer'>(
    trackingScope.defaultTarget?.kind ?? 'shape',
  );

  const handleMotionToggle = (
    field: 'translation' | 'rotation' | 'scale' | 'affine' | 'perspective',
  ) => {
    setMotionModel((prev) => ({ ...prev, ...toggleTransformWithHierarchy(prev, field) }));
  };

  const selectedPath = trackingScope.shapeTargetPath;
  const selectedLayer = trackingScope.layerTarget;
  const selectionKey = `${selectedRotoLayerIds.join(',')}|${selectedRotoPathIds.join(',')}`;
  const effectiveTarget = useMemo<RotoTrackingTarget | null>(() => {
    if (targetKind === 'layer') {
      return trackingScope.layerTargetOption;
    }
    return selectedPath ? { kind: 'shape', pathId: selectedPath.id } : null;
  }, [selectedPath, targetKind, trackingScope.layerTargetOption]);
  const canUseDeform = targetKind === 'shape' && trackingScope.sourcePathIds.length === 1;
  const hasTrackingData = useMemo(() => {
    if (isPendingRotoTrackingLayerTarget(effectiveTarget)) {
      return false;
    }

    if (effectiveTarget?.kind === 'layer') {
      return (
        !!selectedLayer?.trackingTransform ||
        !!selectedLayer?.trackingData ||
        trackingScope.sourcePathIds.some(
          (pathId) => !!node.paths.find((path) => path.id === pathId)?.trackPoints,
        )
      );
    }

    return (
      !!selectedPath?.trackPoints ||
      !!selectedPath?.trackingTransform ||
      !!selectedPath?.trackingData
    );
  }, [effectiveTarget, node.paths, selectedLayer, selectedPath, trackingScope.sourcePathIds]);
  const canTrack =
    !!sourceId && !!effectiveTarget && trackingScope.sourcePathIds.length > 0 && !isTracking;
  const targetLabel =
    effectiveTarget?.kind === 'layer'
      ? isPendingRotoTrackingLayerTarget(effectiveTarget)
        ? `${effectiveTarget.layerName} (new)`
        : (selectedLayer?.name ?? 'Layer')
      : (selectedPath?.name ?? 'Shape');

  useEffect(() => {
    setTargetKind(trackingScope.defaultTarget?.kind ?? 'shape');
  }, [selectionKey, trackingScope.defaultTarget?.kind]);

  useEffect(() => {
    if (!canUseDeform && trackDeform) {
      setTrackDeform(false);
    }
  }, [canUseDeform, trackDeform]);

  const handleTrack = async (direction: 'forward' | 'backward', all: boolean) => {
    if (!sourceId || !effectiveTarget || trackingScope.sourcePathIds.length === 0) return;
    setIsTracking(true);
    try {
      const config: TrackingConfig = {
        translation: motionModel.translation,
        rotation: motionModel.rotation,
        scale: motionModel.scale,
        affine: motionModel.affine,
        perspective: motionModel.perspective,
        deform: trackDeform,
        driftTolerance: rotoTrackingDriftTolerance,
      };
      await trackRotoSelection(
        node.id,
        trackingScope.sourcePathIds,
        effectiveTarget,
        sourceId,
        direction,
        all ? 1000 : 1,
        config,
        { runInBackground: rotoTrackingBackgroundEnabled && all },
      );
    } finally {
      setIsTracking(false);
    }
  };

  const handleSmartTrack = async () => {
    if (!sourceId || !effectiveTarget || trackingScope.sourcePathIds.length === 0) return;
    setIsTracking(true);
    try {
      await smartTrackRotoSelection(
        node.id,
        trackingScope.sourcePathIds,
        effectiveTarget,
        sourceId,
        {
          translation: motionModel.translation,
          rotation: motionModel.rotation,
          scale: motionModel.scale,
          affine: motionModel.affine,
          perspective: motionModel.perspective,
          deform: trackDeform,
          driftTolerance: rotoTrackingDriftTolerance,
        },
        { runInBackground: rotoTrackingBackgroundEnabled },
      );
    } finally {
      setIsTracking(false);
    }
  };

  const handleClearTracking = () => {
    if (!effectiveTarget || isPendingRotoTrackingLayerTarget(effectiveTarget)) return;
    if (window.confirm('Remove tracking data? This will revert to manual keyframes only.')) {
      clearRotoTrackingTarget(node.id, effectiveTarget);
    }
  };

  return (
    <Panel width="w-80">
      <PanelHeader title="Track" onClose={onClose} />
      <div className="space-y-2.5">
        <TrackingSection
          title="Source"
          icon={<Icons.Photo className="h-3.5 w-3.5" />}
          meta={
            <TrackingPill tone={sourceId ? 'accent' : 'warning'}>
              {sourceId ? 'Ready' : 'Missing'}
            </TrackingPill>
          }
        >
          <MediaSourceSelect value={sourceId} options={availableSources} onChange={setSourceId} />
        </TrackingSection>

        <TrackingSection
          title="Target"
          icon={<Icons.Transform className="h-3.5 w-3.5" />}
          meta={
            <TrackingPill tone={effectiveTarget ? 'accent' : 'warning'}>{targetLabel}</TrackingPill>
          }
        >
          <div className="space-y-2">
            {trackingScope.availableTargets.length > 0 && (
              <SegmentedControl
                value={targetKind}
                options={trackingScope.availableTargets.map((kind) => ({
                  value: kind,
                  label: kind === 'layer' ? 'Layer' : 'Shape',
                }))}
                onChange={(value) => setTargetKind(value as 'shape' | 'layer')}
              />
            )}

            <div className="flex flex-wrap gap-1">
              <TrackingPill>
                {trackingScope.sourcePathIds.length} shape
                {trackingScope.sourcePathIds.length === 1 ? '' : 's'}
              </TrackingPill>
              {effectiveTarget?.kind === 'layer' &&
                isPendingRotoTrackingLayerTarget(effectiveTarget) && (
                  <TrackingPill tone="warning">New layer</TrackingPill>
                )}
              {hasTrackingData && <TrackingPill tone="accent">Tracked</TrackingPill>}
            </div>

            {trackingScope.reason && (
              <div className="rounded border border-amber-800/60 bg-amber-950/30 px-2 py-1.5 text-[10px] text-amber-200">
                {trackingScope.reason}
              </div>
            )}
          </div>
        </TrackingSection>

        <TrackingSection title="Motion" icon={<Icons.Curve className="h-3.5 w-3.5" />}>
          <div className="space-y-1.5">
            <div className={`grid grid-cols-3 gap-1 ${trackDeform ? 'opacity-50' : ''}`}>
              <ToggleButton
                label="Trans"
                active={motionModel.translation}
                onClick={() => handleMotionToggle('translation')}
                disabled={trackDeform}
                title="Translation"
                icon={<Icons.ArrowsRightLeft className="h-4 w-4" />}
              />
              <ToggleButton
                label="Scale"
                active={motionModel.scale}
                onClick={() => handleMotionToggle('scale')}
                disabled={trackDeform}
                title="Scale"
                icon={<Icons.ArrowsPointingOut className="h-4 w-4" />}
              />
              <ToggleButton
                label="Rot"
                active={motionModel.rotation}
                onClick={() => handleMotionToggle('rotation')}
                disabled={trackDeform}
                title="Rotation"
                icon={<Icons.RotateLoop className="h-4 w-4" />}
              />
            </div>

            <div className="grid grid-cols-3 gap-1">
              <ToggleButton
                label="Shear"
                active={motionModel.affine}
                onClick={() => {
                  if (trackDeform) setTrackDeform(false);
                  handleMotionToggle('affine');
                }}
                disabled={trackDeform}
                title="Affine / shear"
                icon={<Icons.Shear className="h-4 w-4" />}
              />
              <ToggleButton
                label="Persp"
                active={motionModel.perspective}
                onClick={() => {
                  if (trackDeform) setTrackDeform(false);
                  handleMotionToggle('perspective');
                }}
                disabled={trackDeform}
                title="Perspective"
                icon={<Icons.CubeTransparent className="h-4 w-4" />}
              />
              <ToggleButton
                label="Mesh"
                active={trackDeform}
                onClick={() => setTrackDeform(!trackDeform)}
                title={canUseDeform ? 'Mesh tracking' : 'Mesh tracking needs one shape target'}
                disabled={!canUseDeform}
                icon={<Icons.Pixelate className="h-4 w-4" />}
              />
            </div>
          </div>
        </TrackingSection>

        <TrackingSection title="Safety" icon={<Icons.ExclamationCircle className="h-3.5 w-3.5" />}>
          <div className="space-y-2">
            <SegmentedControl
              value={rotoTrackingBackgroundEnabled ? 'background' : 'inline'}
              options={[
                { value: 'inline', label: 'Inline' },
                { value: 'background', label: 'Background' },
              ]}
              onChange={(value) =>
                setPreferences({ rotoTrackingBackgroundEnabled: value === 'background' })
              }
            />

            <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
              <Slider
                label="Drift Tolerance"
                value={rotoTrackingDriftTolerance}
                min={ROTO_TRACKING_DRIFT_TOLERANCE_MIN}
                max={ROTO_TRACKING_DRIFT_TOLERANCE_MAX}
                step={0.5}
                onChange={(value) => setPreferences({ rotoTrackingDriftTolerance: value })}
                onReset={() =>
                  setPreferences({
                    rotoTrackingDriftTolerance: ROTO_TRACKING_DRIFT_TOLERANCE_DEFAULT,
                  })
                }
                displayFormatter={(value) => value.toFixed(1)}
              />
            </div>
          </div>
        </TrackingSection>

        <TrackingSection
          title="Track"
          icon={<Icons.Play className="h-3.5 w-3.5" />}
          meta={
            <TrackingPill tone={canTrack ? 'accent' : isTracking ? 'warning' : 'neutral'}>
              {isTracking ? 'Running' : canTrack ? 'Armed' : 'Idle'}
            </TrackingPill>
          }
        >
          <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-1.5">
              <TrackingActionButton
                label="Back"
                icon={<Icons.Play className="h-3.5 w-3.5 rotate-180" />}
                onClick={() => handleTrack('backward', true)}
                disabled={!canTrack}
                title="Track backward"
                variant="primary"
              />
              <TrackingActionButton
                label="Forward"
                icon={<Icons.Play className="h-3.5 w-3.5" />}
                onClick={() => handleTrack('forward', true)}
                disabled={!canTrack}
                title="Track forward"
                variant="primary"
              />
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <TrackingActionButton
                label="1 Back"
                icon={<Icons.StepBackward className="h-3.5 w-3.5" />}
                onClick={() => handleTrack('backward', false)}
                disabled={!canTrack}
                title="Track one frame backward"
              />
              <TrackingActionButton
                label="Smart"
                icon={<Icons.Sparkles className="h-3.5 w-3.5" />}
                onClick={handleSmartTrack}
                disabled={!canTrack}
                title="Smart track"
                variant="smart"
              />
              <TrackingActionButton
                label="1 Fwd"
                icon={<Icons.StepForward className="h-3.5 w-3.5" />}
                onClick={() => handleTrack('forward', false)}
                disabled={!canTrack}
                title="Track one frame forward"
              />
            </div>

            {isTracking && (
              <TrackingActionButton
                label="Stop Tracking"
                icon={<Icons.Pause className="h-3.5 w-3.5" />}
                onClick={cancelTracking}
                disabled={false}
                title="Stop tracking"
                variant="danger"
              />
            )}

            {hasTrackingData && (
              <TrackingActionButton
                label="Clear Tracking Data"
                icon={<Icons.Trash className="h-3.5 w-3.5" />}
                onClick={handleClearTracking}
                disabled={isTracking}
                title="Clear tracking data"
                variant="danger"
              />
            )}
          </div>
        </TrackingSection>
      </div>
    </Panel>
  );
};

// ─── Motion Cue panel ──────────────────────────────────────────────────────────

const MotionCuePanel: React.FC<{ node: RotoNode; onClose: () => void }> = ({ node, onClose }) => {
  const {
    rotoMotionCueEnabled,
    rotoMotionCueMode,
    rotoMotionCueScope,
    rotoMotionPathVisible,
    rotoMotionBlurPathVisible,
    rotoMotionTrailFrames,
    setPreferences,
  } = usePreferences();
  const motionBlur = resolveRotoMotionBlurSettings(node.motionBlur);
  const isMotionBlurEnabled = motionBlur.enabled && motionBlur.shutter > 0;

  const modeOptions = useMemo(
    () => [
      { value: 'gradient_trail', label: 'Trail' },
      { value: 'speed_heatline', label: 'Heat' },
    ],
    [],
  );

  const scopeOptions = useMemo(
    () => [
      { value: 'selected', label: 'Selected' },
      { value: 'all', label: 'All' },
    ],
    [],
  );

  return (
    <Panel width="w-72">
      <PanelHeader
        title="Motion Cue"
        onClose={onClose}
        toggle={{
          active: rotoMotionCueEnabled,
          onToggle: () => setPreferences({ rotoMotionCueEnabled: !rotoMotionCueEnabled }),
        }}
      />
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-[10px] text-gray-400 font-medium">Paths</label>
          <div className="flex gap-1">
            <ToggleButton
              label="Motion path"
              active={rotoMotionPathVisible}
              onClick={() => setPreferences({ rotoMotionPathVisible: !rotoMotionPathVisible })}
              icon={<Icons.Curve className="h-4 w-4" />}
            />
            <ToggleButton
              label="Motion blur path"
              active={isMotionBlurEnabled && rotoMotionBlurPathVisible}
              onClick={() =>
                setPreferences({ rotoMotionBlurPathVisible: !rotoMotionBlurPathVisible })
              }
              disabled={!isMotionBlurEnabled}
              icon={<Icons.Bundle className="h-4 w-4" />}
            />
          </div>
        </div>

        <div
          className={
            rotoMotionPathVisible ? 'space-y-3' : 'space-y-3 opacity-60 pointer-events-none'
          }
        >
          <div className="space-y-1">
            <label className="text-[10px] text-gray-400 font-medium">Mode</label>
            <SegmentedControl
              options={modeOptions}
              value={rotoMotionCueMode}
              onChange={(mode) => setPreferences({ rotoMotionCueMode: mode as RotoMotionCueMode })}
            />
          </div>

          <Slider
            label="Trail Window"
            value={rotoMotionTrailFrames}
            min={1}
            max={8}
            step={1}
            onChange={(value) => setPreferences({ rotoMotionTrailFrames: value })}
            onReset={() => setPreferences({ rotoMotionTrailFrames: 3 })}
            displayFormatter={(value) => `±${Math.round(value)}f`}
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] text-gray-400 font-medium">Scope</label>
          <SegmentedControl
            options={scopeOptions}
            value={rotoMotionCueScope}
            onChange={(scope) =>
              setPreferences({ rotoMotionCueScope: scope as RotoMotionCueScope })
            }
          />
        </div>

        <div className="rounded border border-gray-700 bg-gray-900/70 p-2">
          {rotoMotionCueMode === 'gradient_trail' ? (
            <div className="space-y-1">
              <div className="h-2 rounded bg-gradient-to-r from-blue-500 via-yellow-300 to-fuchsia-500" />
              <div className="flex justify-between text-[10px] text-gray-400">
                <span>Past</span>
                <span>Current</span>
                <span>Future</span>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="h-2 rounded bg-gradient-to-r from-blue-500 via-yellow-300 to-red-500" />
              <div className="flex justify-between text-[10px] text-gray-400">
                <span>Slow</span>
                <span>Fast</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
};

// ─── Root panel dispatcher ─────────────────────────────────────────────────────

const RotoToolPanels: React.FC<{
  node: AnyNode;
  openPanels: ReadonlySet<string>;
  onPanelClose: (panel: string) => void;
}> = ({ node, openPanels, onPanelClose }) => {
  const rotoNode = node as RotoNode;

  return (
    <>
      {openPanels.has('nudge') && <NudgePanel onClose={() => onPanelClose('nudge')} />}
      {openPanels.has('trace') && (
        <AutoTracePanel node={rotoNode} onClose={() => onPanelClose('trace')} />
      )}
      {openPanels.has('tracking') && (
        <TrackingPanel node={rotoNode} onClose={() => onPanelClose('tracking')} />
      )}
      {openPanels.has('motion-cue') && (
        <MotionCuePanel node={rotoNode} onClose={() => onPanelClose('motion-cue')} />
      )}
    </>
  );
};

export default RotoToolPanels;
