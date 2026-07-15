import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  AnyNode,
  MatchMoveMode,
  MatchMoveNode,
  MatchMoveSolveModel,
  MatchMoveSolveResult,
  MatchMoveTrackingSettings,
} from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import {
  CollapsibleSection,
  IconButton,
  NumberInput,
  Slider,
  StyledDropdown,
} from '@blackboard/ui';
import { ExecuteButton, SegmentedControl, ToggleSettingRow } from '@/components';
import { useNodeExecutionHandler } from '@/hooks/useNodeExecutionHandler';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import {
  createSourcePixelDataReader,
  resolveSourcePixelSource,
} from '@/state/editor/services/sourcePixelData';
import { registerBackgroundJobCancelHandler } from '@/state/editor/services/backgroundJobs';
import {
  getDefaultMediaSourceId,
  getMediaSourceLabel,
  getMediaSourceOptions,
} from '@/utils/mediaSourceSelection';
import { runMatchMoveTracking } from '@/utils/matchMoveTracking';

const MINI_LABEL_CLASS = 'text-[9px] font-semibold uppercase tracking-[0.12em] text-gray-500';

const modeOptions = [
  { value: 'track_2d', label: '2D' },
  { value: 'planar', label: 'Planar' },
  { value: 'camera_3d', label: 'Camera' },
];

const solveModelOptions = [
  { value: 'translation', label: 'Move' },
  { value: 'similarity', label: 'TRS' },
  { value: 'affine', label: 'Affine' },
  { value: 'homography', label: 'Planar' },
];

const lensModelOptions = [
  { value: 'none', label: 'None' },
  { value: 'brown_conrady', label: 'Brown' },
];

const formatNumber = (value: number | undefined, digits = 2): string =>
  Number.isFinite(value) ? (value as number).toFixed(digits) : '-';

const clampFrame = (value: number, startFrame: number, endFrame: number): number => {
  if (!Number.isFinite(value)) return startFrame;
  return Math.max(startFrame, Math.min(endFrame, Math.round(value)));
};

const getStatusClassName = (result: MatchMoveSolveResult | undefined): string => {
  if (!result || result.status === 'idle') return 'border-white/10 bg-white/[0.04] text-gray-300';
  if (result.status === 'solved') return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200';
  if (result.status === 'partial') return 'border-yellow-400/25 bg-yellow-500/10 text-yellow-100';
  return 'border-red-400/25 bg-red-500/10 text-red-100';
};

const statusLabel = (result: MatchMoveSolveResult | undefined): string => {
  if (!result) return 'Idle';
  if (result.status === 'solved') return 'Solved';
  if (result.status === 'partial') return 'Partial';
  if (result.status === 'failed') return 'Failed';
  if (result.status === 'running') return 'Running';
  return 'Idle';
};

function LabeledNumberInput({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="min-w-0 space-y-1">
      <span className={MINI_LABEL_CLASS}>{label}</span>
      <NumberInput
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        onValueChange={onChange}
      />
    </label>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return <ToggleSettingRow label={label} checked={checked} onCheckedChange={onChange} />;
}

function ResultMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 rounded-md bg-gray-950/40 px-2 py-1.5">
      <div className={MINI_LABEL_CLASS}>{label}</div>
      <div className="truncate font-mono text-xs text-gray-100">{value}</div>
    </div>
  );
}

function MatchMoveAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as MatchMoveNode;
  const nodes = useEditorSelector((state) => state.nodes);
  const currentFrame = useEditorSelector((state) => state.currentFrame);
  const timelineStartFrame = useEditorSelector((state) => state.timelineStartFrame);
  const maxFrames = useEditorSelector((state) => state.maxFrames);
  const fps = useEditorSelector((state) => state.fps);
  const projectId = useEditorSelector((state) => state.projectId);
  const projectColorManagement = useEditorSelector((state) => state.colorManagement);
  const actions = useEditorActions();
  const abortRef = useRef<AbortController | null>(null);
  const [runState, setRunState] = useState<{
    running: boolean;
    progress: number;
    detail: string;
  }>({ running: false, progress: 0, detail: '' });

  const sourceOptions = useMemo(() => getMediaSourceOptions(nodes, node.id), [node.id, nodes]);
  const defaultSourceId = useMemo(() => getDefaultMediaSourceId(nodes, node.id), [node.id, nodes]);
  const sourceId = sourceOptions.some((option) => option.value === node.tracking.sourceId)
    ? node.tracking.sourceId
    : defaultSourceId || sourceOptions[0]?.value || '';
  const sourceLabel = getMediaSourceLabel(nodes, node.id, sourceId) ?? 'No source';
  const sourceDropdownOptions = sourceOptions.map((option) => ({
    value: option.value,
    label: option.label,
    secondaryLabel: option.description,
  }));

  const commitTracking = useCallback(
    (patch: Partial<MatchMoveTrackingSettings>) => {
      actions.updateNode(node.id, { tracking: { ...node.tracking, ...patch } }, true);
    },
    [actions, node.id, node.tracking],
  );

  const commitSolve = useCallback(
    (patch: Partial<MatchMoveNode['solve']>) => {
      const nextSolve = { ...node.solve, ...patch };
      actions.updateNode(node.id, { solve: nextSolve }, true);
    },
    [actions, node.id, node.solve],
  );

  const commitCamera = useCallback(
    (patch: Partial<MatchMoveNode['camera']>) => {
      actions.updateNode(node.id, { camera: { ...node.camera, ...patch } }, true);
    },
    [actions, node.camera, node.id],
  );

  const commitDisplay = useCallback(
    (patch: Partial<MatchMoveNode['display']>) => {
      actions.updateNode(node.id, { display: { ...node.display, ...patch } }, true);
    },
    [actions, node.display, node.id],
  );

  const clearTracks = useCallback(() => {
    actions.updateNode(
      node.id,
      {
        tracks: [],
        solveResult: {
          status: 'idle',
          startFrame: node.tracking.startFrame,
          endFrame: node.tracking.endFrame,
          model: node.solve.model,
          frames: [],
        },
      },
      true,
    );
  }, [actions, node.id, node.solve.model, node.tracking.endFrame, node.tracking.startFrame]);

  const runTracking = useCallback(async () => {
    if (runState.running) {
      abortRef.current?.abort();
      return;
    }

    const effectiveSourceId = sourceId || defaultSourceId;
    if (!effectiveSourceId) {
      actions.updateNode(
        node.id,
        {
          solveResult: {
            status: 'failed',
            message: 'Choose a track source first.',
            startFrame: node.tracking.startFrame,
            endFrame: node.tracking.endFrame,
            model: node.solve.model,
            frames: [],
          },
        },
        true,
      );
      return;
    }

    const source = resolveSourcePixelSource(
      nodes,
      node.id,
      effectiveSourceId,
      projectColorManagement,
    );
    if (!source) {
      actions.updateNode(
        node.id,
        {
          solveResult: {
            status: 'failed',
            message: 'The selected source cannot be read as trackable pixels.',
            startFrame: node.tracking.startFrame,
            endFrame: node.tracking.endFrame,
            model: node.solve.model,
            frames: [],
          },
        },
        true,
      );
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setRunState({ running: true, progress: 0, detail: 'Preparing source' });

    const jobId =
      actions.startBackgroundJob?.({
        type: 'tracking',
        title: 'Match Move',
        subtitle: node.name,
        detail: 'Preparing source',
        status: 'running',
        progress: 0,
        indeterminate: false,
        cancellable: true,
        source: {
          projectId: projectId ?? undefined,
          nodeId: node.id,
          upstreamNodeIds:
            source.kind === 'media-node' ? [source.node.id] : source.nodes.map((item) => item.id),
        },
      }) ?? null;
    const unregisterCancel = jobId
      ? registerBackgroundJobCancelHandler(jobId, () => controller.abort())
      : undefined;
    const reader = createSourcePixelDataReader(source, fps || 30);

    try {
      const trackingSettings = {
        ...node.tracking,
        sourceId: effectiveSourceId,
        startFrame: clampFrame(node.tracking.startFrame, timelineStartFrame, maxFrames),
        endFrame: clampFrame(node.tracking.endFrame, timelineStartFrame, maxFrames),
      };
      const result = await runMatchMoveTracking({
        getFramePixelData: reader.getFramePixelData,
        tracking: trackingSettings,
        mode: node.solve.mode,
        model: node.solve.model,
        ransacThreshold: node.solve.ransacThreshold,
        camera: node.camera,
        signal: controller.signal,
        onProgress: (progress, detail) => {
          setRunState({ running: true, progress, detail });
          if (jobId) {
            actions.updateBackgroundJob?.(jobId, { progress, detail });
          }
        },
      });

      if (controller.signal.aborted) {
        if (jobId) {
          actions.finishBackgroundJob?.(jobId, {
            status: 'cancelled',
            detail: 'Cancelled',
            progress: runState.progress,
          });
        }
        return;
      }

      actions.updateNode(
        node.id,
        {
          tracking: trackingSettings,
          tracks: result.tracks,
          solveResult: result.solveResult,
        },
        true,
      );
      if (jobId) {
        actions.finishBackgroundJob?.(jobId, {
          status: result.solveResult.status === 'failed' ? 'error' : 'complete',
          detail: result.solveResult.message ?? `${result.tracks.length} tracks`,
          progress: 100,
          error: result.solveResult.status === 'failed' ? result.solveResult.message : undefined,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tracking failed.';
      actions.updateNode(
        node.id,
        {
          solveResult: {
            status: 'failed',
            message,
            startFrame: node.tracking.startFrame,
            endFrame: node.tracking.endFrame,
            model: node.solve.model,
            frames: [],
          },
        },
        true,
      );
      if (jobId) {
        actions.finishBackgroundJob?.(jobId, {
          status: controller.signal.aborted ? 'cancelled' : 'error',
          detail: controller.signal.aborted ? 'Cancelled' : message,
          error: controller.signal.aborted ? undefined : message,
        });
      }
    } finally {
      reader.dispose();
      unregisterCancel?.();
      abortRef.current = null;
      setRunState({ running: false, progress: 0, detail: '' });
    }
  }, [
    actions,
    defaultSourceId,
    fps,
    maxFrames,
    node.camera,
    node.id,
    node.name,
    node.solve,
    node.tracking,
    nodes,
    projectColorManagement,
    projectId,
    runState.progress,
    runState.running,
    sourceId,
    timelineStartFrame,
  ]);

  useNodeExecutionHandler(node.id, runTracking);

  const solveFrame = useMemo(() => {
    if (!node.solveResult?.frames.length) return null;
    return (
      node.solveResult.frames.find((entry) => entry.frame === currentFrame) ??
      node.solveResult.frames[node.solveResult.frames.length - 1]
    );
  }, [currentFrame, node.solveResult?.frames]);

  const trackCount = node.tracks.length;
  const solvedFrames = node.solveResult?.frames.length ?? 0;
  const canRun = !!sourceId && sourceOptions.length > 0;

  return (
    <div className="space-y-3">
      <div className={`rounded-md border px-3 py-2 ${getStatusClassName(node.solveResult)}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold">{statusLabel(node.solveResult)}</div>
            <div className="truncate text-[10px] opacity-75">{sourceLabel}</div>
          </div>
          <div className="shrink-0 font-mono text-[10px] opacity-80">
            {trackCount} pts / {solvedFrames} frames
          </div>
        </div>
        {node.solveResult?.message ? (
          <div className="mt-1 text-[10px] leading-4 opacity-80">{node.solveResult.message}</div>
        ) : null}
      </div>

      <CollapsibleSection title="Source" defaultOpen>
        <div className="space-y-3">
          <StyledDropdown
            value={sourceId}
            options={sourceDropdownOptions}
            onChange={(value) => commitTracking({ sourceId: String(value) })}
          />
          <div className="grid grid-cols-3 gap-1.5">
            <LabeledNumberInput
              label="Start"
              value={node.tracking.startFrame}
              min={timelineStartFrame}
              max={maxFrames}
              onChange={(value) =>
                commitTracking({
                  startFrame: clampFrame(value, timelineStartFrame, maxFrames),
                })
              }
            />
            <LabeledNumberInput
              label="End"
              value={node.tracking.endFrame}
              min={timelineStartFrame}
              max={maxFrames}
              onChange={(value) =>
                commitTracking({
                  endFrame: clampFrame(value, timelineStartFrame, maxFrames),
                })
              }
            />
            <div className="grid grid-rows-2 gap-1">
              <button
                type="button"
                className="rounded bg-white/[0.05] px-2 text-[10px] font-semibold text-gray-300 hover:bg-white/[0.08]"
                onClick={() =>
                  commitTracking({
                    startFrame: clampFrame(currentFrame, timelineStartFrame, maxFrames),
                  })
                }
              >
                Start
              </button>
              <button
                type="button"
                className="rounded bg-white/[0.05] px-2 text-[10px] font-semibold text-gray-300 hover:bg-white/[0.08]"
                onClick={() =>
                  commitTracking({
                    endFrame: clampFrame(currentFrame, timelineStartFrame, maxFrames),
                  })
                }
              >
                End
              </button>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Track" defaultOpen>
        <div className="space-y-4">
          <Slider
            label="Features"
            value={node.tracking.maxFeatures}
            min={12}
            max={800}
            step={1}
            onChange={(value) => commitTracking({ maxFeatures: Math.round(value) })}
            displayFormatter={(value) => String(Math.round(value))}
          />
          <Slider
            label="Spacing"
            value={node.tracking.minFeatureDistance}
            min={6}
            max={96}
            step={1}
            onChange={(value) => commitTracking({ minFeatureDistance: Math.round(value) })}
            displayFormatter={(value) => `${Math.round(value)}px`}
          />
          <Slider
            label="Quality"
            value={node.tracking.featureQuality}
            min={0.005}
            max={0.2}
            step={0.005}
            onChange={(value) => commitTracking({ featureQuality: value })}
            displayFormatter={(value) => value.toFixed(3)}
          />
          <div className="grid grid-cols-2 gap-1.5">
            <LabeledNumberInput
              label="Patch"
              value={node.tracking.patchSize}
              min={5}
              max={31}
              step={2}
              onChange={(value) => commitTracking({ patchSize: Math.max(5, Math.round(value)) })}
            />
            <LabeledNumberInput
              label="Max Err"
              value={node.tracking.maxTrackError}
              min={0.5}
              max={100}
              step={0.5}
              onChange={(value) => commitTracking({ maxTrackError: Math.max(0.5, value) })}
            />
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Solve" defaultOpen>
        <div className="space-y-4">
          <div className="space-y-2">
            <div className={MINI_LABEL_CLASS}>Mode</div>
            <SegmentedControl
              options={modeOptions}
              value={node.solve.mode}
              onChange={(value) => {
                const mode = value as MatchMoveMode;
                commitSolve({
                  mode,
                  model:
                    mode === 'track_2d'
                      ? 'similarity'
                      : mode === 'camera_3d'
                        ? 'homography'
                        : node.solve.model,
                });
              }}
            />
          </div>
          <div className="space-y-2">
            <div className={MINI_LABEL_CLASS}>Model</div>
            <SegmentedControl
              options={solveModelOptions}
              value={node.solve.model}
              onChange={(value) => commitSolve({ model: value as MatchMoveSolveModel })}
            />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <LabeledNumberInput
              label="RANSAC"
              value={node.solve.ransacThreshold}
              min={0.25}
              max={20}
              step={0.25}
              onChange={(value) => commitSolve({ ransacThreshold: Math.max(0.25, value) })}
            />
            <LabeledNumberInput
              label="Min Frames"
              value={node.solve.minTrackFrames}
              min={1}
              max={200}
              step={1}
              onChange={(value) => commitSolve({ minTrackFrames: Math.max(1, Math.round(value)) })}
            />
          </div>

          {node.solve.mode === 'camera_3d' ? (
            <div className="space-y-3 border-t border-white/10 pt-3">
              <div className="grid grid-cols-2 gap-1.5">
                <LabeledNumberInput
                  label="Focal mm"
                  value={node.camera.focalLengthMm}
                  min={1}
                  max={300}
                  step={0.5}
                  onChange={(value) => commitCamera({ focalLengthMm: Math.max(1, value) })}
                />
                <LabeledNumberInput
                  label="Sensor mm"
                  value={node.camera.sensorWidthMm}
                  min={1}
                  max={120}
                  step={0.1}
                  onChange={(value) => commitCamera({ sensorWidthMm: Math.max(1, value) })}
                />
              </div>
              <StyledDropdown
                value={node.camera.lensDistortionModel}
                options={lensModelOptions}
                onChange={(value) =>
                  commitCamera({
                    lensDistortionModel: value as MatchMoveNode['camera']['lensDistortionModel'],
                  })
                }
              />
              <div className="rounded-md border border-yellow-400/20 bg-yellow-500/10 px-2 py-2 text-[10px] leading-4 text-yellow-100">
                Browser tracking is active; full camera reconstruction needs a SfM backend.
              </div>
            </div>
          ) : null}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Display" defaultOpen={false}>
        <div className="space-y-3">
          <ToggleRow
            label="Features"
            checked={node.display.showFeatures}
            onChange={(checked) => commitDisplay({ showFeatures: checked })}
          />
          <ToggleRow
            label="Trails"
            checked={node.display.showTrails}
            onChange={(checked) => commitDisplay({ showTrails: checked })}
          />
          <ToggleRow
            label="Error Color"
            checked={node.display.colorByError}
            onChange={(checked) => commitDisplay({ colorByError: checked })}
          />
          <Slider
            label="Trail"
            value={node.display.trailLength}
            min={2}
            max={120}
            step={1}
            onChange={(value) => commitDisplay({ trailLength: Math.round(value) })}
            displayFormatter={(value) => `${Math.round(value)}f`}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Result" defaultOpen>
        <div className="grid grid-cols-2 gap-1.5">
          <ResultMetric label="Residual" value={formatNumber(node.solveResult?.averageResidual)} />
          <ResultMetric label="Frame" value={solveFrame?.frame ?? '-'} />
          <ResultMetric label="X" value={formatNumber(solveFrame?.translate.x)} />
          <ResultMetric label="Y" value={formatNumber(solveFrame?.translate.y)} />
          <ResultMetric label="Scale X" value={formatNumber(solveFrame?.scale.x, 4)} />
          <ResultMetric label="Rotate" value={`${formatNumber(solveFrame?.rotation)} deg`} />
        </div>
      </CollapsibleSection>

      {runState.running ? (
        <div className="space-y-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-primary-400 transition-[width]"
              style={{ width: `${Math.max(2, Math.min(100, runState.progress))}%` }}
            />
          </div>
          <div className="truncate text-[10px] text-gray-500">{runState.detail}</div>
        </div>
      ) : null}

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <ExecuteButton
          fullWidth
          className="min-h-8"
          disabled={!runState.running && !canRun}
          onClick={runTracking}
          title={runState.running ? 'Cancel tracking and solve' : 'Track features and solve motion'}
          icon={
            runState.running ? <Icons.XMark className="h-3.5 w-3.5 text-primary-200" /> : undefined
          }
        >
          {runState.running ? 'Cancel' : 'Track and Solve'}
        </ExecuteButton>
        <IconButton
          icon={Icons.Trash}
          tooltip="Clear tracking data"
          onClick={clearTracks}
          className="h-8 w-8 border border-white/10 bg-white/[0.04] text-gray-400 hover:bg-white/[0.08] hover:text-gray-100"
        />
      </div>
    </div>
  );
}

export default MatchMoveAdjustments;
