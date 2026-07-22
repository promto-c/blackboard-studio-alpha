import React, { useState, useMemo, useEffect } from 'react';
import {
  AnyNode,
  type HybridTrackingConfig,
  RotoNode,
  type TemporalTrackingConfig,
  type TemporalTrackingMode,
  type TemporalTrackingRepair,
  type TrackingAlgorithm,
  TrackingConfig,
  type RotoSegmentationModelVariant,
} from '@blackboard/types';
import type { RotoMotionCueScope, RotoMotionCueMode } from '@blackboard/types';
import * as Icons from '@blackboard/icons';

import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { useMediaSourceSelection } from '@/hooks/useMediaSourceSelection';
import { usePreferences } from '@/state/preferencesContext';
import { RotoTrackingDriftTolerance } from '@/state/preferences';
import { Badge, Slider, StyledDropdown, TextInput, ToggleButton } from '@blackboard/ui';
import {
  MediaSourceSelect,
  SegmentedControl,
  ViewportToolPanel as Panel,
  ViewportToolPanelHeader as PanelHeader,
  ViewportToolPanelSection as PanelSection,
  ViewportToolPanelSectionStack as PanelSectionStack,
} from '@/components';
import { toggleTransformWithHierarchy } from '@/utils/transformHierarchy';
import {
  getRotoMatchTemplateFrames,
  isPendingRotoTrackingLayerTarget,
  resolveRotoTrackingSelection,
  type RotoTrackingTarget,
} from '@/utils/rotoTracking';
import { resolveRotoMotionBlurSettings } from '@/utils/rotoMotionBlur';
import {
  getSourcePixelDataForFrame,
  resolveSourcePixelSource,
} from '@/state/editor/services/sourcePixelData';
import { findSceneNode } from '@/utils/graphCommands';
import { getMediaSourceLabel } from '@/utils/mediaSourceSelection';
import {
  clearSegmentationPrompts,
  dismissSegmentationError,
  prepareSegmentationSession,
  redoSegmentationPrompt,
  reportSegmentationError,
  resetSegmentationPrompts,
  resetSegmentationSession,
  setSegmentationCleanup,
  setSegmentationPromptLabel,
  setSegmentationPromptMode,
  undoSegmentationPrompt,
  useSegmentationSession,
} from '@/services/segmentation/segmentationSession';
import {
  DEFAULT_SAM3_MODEL_VARIANT,
  getSam3ModelVariant,
  SAM3_MODEL_VARIANTS,
} from '@/services/models/builtinModelRegistry';
import { usePreferencesNavigation } from '@/features/projects/preferencesNavigation';
import { RotoPartSeparationPanel } from './RotoPartSeparationPanel';

const hashSourceRevision = (value: unknown): string => {
  const input = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
};

function NudgePanel({ onClose }: { onClose: () => void }) {
  const { nudgeRadius, setPreferences } = usePreferences();
  return (
    <Panel>
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
}

function AutoTracePanel({ node, onClose }: { node: RotoNode; onClose: () => void }) {
  const nodes = useEditorSelector((s) => s.nodes);
  const selectedRotoPathIds = useEditorSelector(
    (s) => s.hierarchySelections[s.selectedNodeId ?? '']?.itemIds ?? [],
  );
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
}

function SmartMaskPanel({ node, onClose }: { node: RotoNode; onClose: () => void }) {
  const nodes = useEditorSelector((state) => state.nodes);
  const currentFrame = useEditorSelector((state) => state.currentFrame);
  const fps = useEditorSelector((state) => state.fps);
  const colorManagement = useEditorSelector((state) => state.colorManagement);
  const session = useSegmentationSession(node.id);
  const { setActiveViewportTool, commitRotoSegmentationMask, updateNode } = useEditorActions();
  const { openPreferences } = usePreferencesNavigation();
  const { onnxRuntimeWebGpuEnabled, onnxRuntimeWasmEnabled } = usePreferences();
  const {
    sourceId,
    setSourceId,
    options: availableSources,
  } = useMediaSourceSelection(nodes, node.id);
  const [maskName, setMaskName] = useState('Smart Mask');
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const modelVariant = node.segmentationModelVariant ?? DEFAULT_SAM3_MODEL_VARIANT;
  const modelVariantDefinition = getSam3ModelVariant(modelVariant);
  const modelVariantBackendEnabled = modelVariantDefinition.supportedBackends.some((backend) =>
    backend === 'webgpu' ? onnxRuntimeWebGpuEnabled : onnxRuntimeWasmEnabled,
  );

  const isBusy =
    isCapturing ||
    session.status === 'loading-model' ||
    session.status === 'encoding' ||
    session.status === 'decoding' ||
    session.status === 'cleaning';
  const canPrompt = Boolean(
    session.preparedKey &&
    session.sourceId === sourceId &&
    session.sourceFrame === currentFrame &&
    session.status !== 'loading-model',
  );
  const canAccept = Boolean(
    session.mask &&
    session.contour &&
    session.sourceId === sourceId &&
    session.sourceFrame === currentFrame &&
    session.status === 'ready' &&
    !isSaving,
  );

  useEffect(() => {
    if (session.promptMode === 'point') setActiveViewportTool('segment-point');
    else setActiveViewportTool('segment-box');
  }, [session.promptMode, setActiveViewportTool]);

  const analyzeFrame = async () => {
    if (!sourceId) return;
    setIsCapturing(true);
    try {
      const source = resolveSourcePixelSource(nodes, node.id, sourceId, colorManagement);
      const sceneNode = findSceneNode(nodes);
      if (!source || !sceneNode) throw new Error('The selected source is not available.');

      const pixels = await getSourcePixelDataForFrame(source, currentFrame, fps || 30, {
        finalColorSpace: 'srgb',
      });
      if (!pixels) throw new Error('Could not read pixels from the selected source.');
      const sourceLabel =
        getMediaSourceLabel(nodes, node.id, sourceId) ??
        (source.kind === 'media-node' ? source.node.name : 'Upstream Result');
      const sourceRevision =
        source.kind === 'media-node'
          ? hashSourceRevision(source.node)
          : hashSourceRevision(source.nodes);

      setIsCapturing(false);
      await prepareSegmentationSession({
        nodeId: node.id,
        sourceId,
        sourceLabel,
        sourceFrame: currentFrame,
        modelVariant,
        runtimePreferences: {
          webgpuEnabled: onnxRuntimeWebGpuEnabled,
          wasmEnabled: onnxRuntimeWasmEnabled,
        },
        input: {
          key: `${sourceId}:${currentFrame}:${sourceRevision}:${hashSourceRevision(colorManagement)}:${pixels.width}x${pixels.height}`,
          data: pixels.data,
          width: pixels.width,
          height: pixels.height,
          sceneWidth: sceneNode.width,
          sceneHeight: sceneNode.height,
        },
      });
    } catch (error) {
      reportSegmentationError(node.id, error);
    } finally {
      setIsCapturing(false);
    }
  };

  const acceptMask = async () => {
    if (!session.mask || !session.contour || !session.sourceId || session.sourceFrame == null) {
      return;
    }

    setIsSaving(true);
    try {
      const pathId = await commitRotoSegmentationMask({
        rotoNodeId: node.id,
        name: maskName.trim() || 'Smart Mask',
        sourceId: session.sourceId,
        sourceFrame: session.sourceFrame,
        modelId: session.modelId,
        modelVariant: session.modelVariant,
        width: session.imageWidth,
        height: session.imageHeight,
        score: session.score ?? undefined,
        points: session.points.map(({ x, y, label }) => ({ x, y, label })),
        box: session.box ?? undefined,
        cleanup: {
          threshold: session.cleanup.threshold,
          removeSpecks: session.cleanup.removeSpecks,
          fillHoles: session.cleanup.fillHoles,
        },
        mask: session.mask,
        contour: session.contour,
        epsilon: session.cleanup.contourDetail,
      });
      if (!pathId) throw new Error('The mask contour could not be converted into a shape.');
      resetSegmentationPrompts(node.id);
      setActiveViewportTool('select');
    } catch (error) {
      reportSegmentationError(node.id, error);
    } finally {
      setIsSaving(false);
    }
  };

  const statusLabel = isCapturing
    ? 'Reading frame'
    : session.status === 'loading-model'
      ? 'Loading model'
      : session.status === 'encoding'
        ? 'Encoding frame'
        : session.status === 'decoding'
          ? 'Updating mask'
          : session.status === 'cleaning'
            ? 'Cleaning mask'
            : session.preparedKey
              ? 'Prompt ready'
              : 'Not analyzed';

  return (
    <Panel>
      <PanelHeader
        title="Smart Mask"
        onClose={() => {
          setActiveViewportTool('select');
          onClose();
        }}
      />
      <div className="space-y-3">
        <div className="rounded-md border border-sky-400/15 bg-sky-400/[0.06] p-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-sky-100">
                SAM3 Tracker · {modelVariantDefinition.shortLabel} ·{' '}
                {session.backend === 'webgpu'
                  ? 'WebGPU'
                  : session.backend === 'wasm'
                    ? 'WASM'
                    : 'On-device'}
              </p>
              <p className="mt-0.5 text-[10px] leading-4 text-gray-400">
                The frame is encoded once. Point and box edits reuse its embedding.
              </p>
            </div>
            <Badge size="sm" uppercase variant={session.status === 'error' ? 'danger' : 'neutral'}>
              {statusLabel}
            </Badge>
          </div>
          {session.modelProgress?.total ? (
            <div className="mt-2 space-y-1">
              <div className="h-1 overflow-hidden rounded bg-white/10">
                <div
                  className="h-full rounded bg-sky-400 transition-[width]"
                  style={{ width: `${session.modelProgress.progress ?? 0}%` }}
                />
              </div>
              <div className="flex justify-between gap-2 text-[9px] text-gray-500">
                <span className="truncate">{session.modelProgress.file ?? 'Model files'}</span>
                <span className="shrink-0">
                  {formatBytes(session.modelProgress.loaded)} /{' '}
                  {formatBytes(session.modelProgress.total)}
                </span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-1.5 rounded-md border border-white/[0.07] bg-black/20 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <label className="text-[10px] font-medium text-gray-400">Model variant</label>
            <button
              type="button"
              onClick={() => openPreferences({ section: 'models' })}
              className="text-[9px] text-sky-300 transition hover:text-sky-100"
            >
              Manage models
            </button>
          </div>
          <StyledDropdown
            value={modelVariant}
            options={SAM3_MODEL_VARIANTS.map((variant) => ({
              value: variant.id,
              label: variant.label,
              secondaryLabel: variant.supportedBackends
                .map((backend) => backend.toUpperCase())
                .join(' / '),
            }))}
            onChange={(value) => {
              const nextVariant = value as RotoSegmentationModelVariant;
              if (nextVariant === modelVariant) return;
              updateNode(node.id, { segmentationModelVariant: nextVariant });
              resetSegmentationSession(node.id);
            }}
            density="compact"
            disabled={isBusy}
          />
          <p className="text-[9px] leading-4 text-gray-500">{modelVariantDefinition.description}</p>
          {!modelVariantBackendEnabled ? (
            <p className="text-[9px] leading-4 text-amber-300">
              Enable a compatible backend in Models preferences before analyzing.
            </p>
          ) : null}
        </div>

        <MediaSourceSelect
          value={sourceId}
          options={availableSources}
          onChange={(nextSourceId) => {
            setSourceId(nextSourceId);
            resetSegmentationSession(node.id);
          }}
        />
        <button
          type="button"
          onClick={() => void analyzeFrame()}
          disabled={
            !sourceId ||
            !modelVariantBackendEnabled ||
            isCapturing ||
            session.status === 'loading-model' ||
            session.status === 'encoding'
          }
          className="w-full rounded-md border border-sky-400/25 bg-sky-500/15 py-2 text-xs font-medium text-sky-50 transition-colors hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isCapturing
            ? 'Reading frame…'
            : session.status === 'loading-model'
              ? 'Loading model…'
              : session.status === 'encoding'
                ? 'Encoding frame…'
                : session.preparedKey &&
                    session.sourceId === sourceId &&
                    session.sourceFrame === currentFrame
                  ? 'Refresh frame embedding'
                  : 'Analyze current frame'}
        </button>

        {session.error ? (
          <div className="rounded-md border border-red-400/20 bg-red-500/10 p-2 text-[10px] leading-4 text-red-100">
            <div className="flex items-start justify-between gap-2">
              <span>{session.error}</span>
              <button
                type="button"
                onClick={() => dismissSegmentationError(node.id)}
                className="text-red-200 hover:text-white"
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}

        <div className={canPrompt ? 'space-y-3' : 'pointer-events-none space-y-3 opacity-45'}>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-gray-400">Prompt tool</label>
            <SegmentedControl
              options={[
                { value: 'point', label: 'Points' },
                { value: 'box', label: 'Box' },
              ]}
              value={session.promptMode}
              onChange={(value) => setSegmentationPromptMode(node.id, value as 'point' | 'box')}
            />
          </div>

          {session.promptMode === 'point' ? (
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-gray-400">Click meaning</label>
              <SegmentedControl
                options={[
                  { value: 'include', label: 'Include' },
                  { value: 'exclude', label: 'Exclude' },
                ]}
                value={session.promptLabel}
                onChange={(value) =>
                  setSegmentationPromptLabel(node.id, value as 'include' | 'exclude')
                }
              />
              <p className="text-[9px] leading-4 text-gray-500">
                Hover previews the mask. Click to confirm; Alt-click excludes an area.
              </p>
            </div>
          ) : (
            <p className="text-[9px] leading-4 text-gray-500">
              Drag a tight box around the subject, then refine it with include or exclude points.
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => undoSegmentationPrompt(node.id)}
              disabled={session.promptHistoryIndex === 0}
              title="Undo prompt (Ctrl/Cmd+Z)"
              className="flex-1 rounded border border-white/10 bg-white/[0.04] py-1.5 text-[10px] text-gray-300 hover:bg-white/[0.08] disabled:opacity-40"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={() => redoSegmentationPrompt(node.id)}
              disabled={session.promptHistoryIndex >= session.promptHistory.length - 1}
              title="Redo prompt (Ctrl/Cmd+Shift+Z)"
              className="flex-1 rounded border border-white/10 bg-white/[0.04] py-1.5 text-[10px] text-gray-300 hover:bg-white/[0.08] disabled:opacity-40"
            >
              Redo
            </button>
            <button
              type="button"
              onClick={() => clearSegmentationPrompts(node.id)}
              disabled={session.points.length === 0 && !session.box}
              className="flex-1 rounded border border-white/10 bg-white/[0.04] py-1.5 text-[10px] text-gray-300 hover:bg-white/[0.08] disabled:opacity-40"
            >
              Clear
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1 rounded-md border border-white/[0.07] bg-black/20 p-2 text-center">
            <div>
              <div className="text-xs font-semibold text-emerald-300">
                {session.points.filter((point) => point.label === 'include').length}
              </div>
              <div className="text-[9px] text-gray-500">Include</div>
            </div>
            <div>
              <div className="text-xs font-semibold text-rose-300">
                {session.points.filter((point) => point.label === 'exclude').length}
              </div>
              <div className="text-[9px] text-gray-500">Exclude</div>
            </div>
            <div>
              <div className="text-xs font-semibold text-sky-200">
                {session.score == null ? '—' : `${Math.round(session.score * 100)}%`}
              </div>
              <div className="text-[9px] text-gray-500">Confidence</div>
            </div>
          </div>

          {session.logits ? (
            <div className="space-y-2 rounded-md border border-white/[0.07] bg-black/20 p-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                Mask cleanup
              </div>
              <Slider
                label="Edge threshold"
                value={session.cleanup.threshold}
                min={-1}
                max={1}
                step={0.02}
                onChange={(threshold) => setSegmentationCleanup(node.id, { threshold })}
                onReset={() => setSegmentationCleanup(node.id, { threshold: 0 })}
                displayFormatter={(value) => value.toFixed(2)}
              />
              <Slider
                label="Remove specks"
                value={session.cleanup.removeSpecks}
                min={0}
                max={2048}
                step={8}
                onChange={(removeSpecks) => setSegmentationCleanup(node.id, { removeSpecks })}
                onReset={() => setSegmentationCleanup(node.id, { removeSpecks: 64 })}
                displayFormatter={(value) => `${Math.round(value)}px²`}
              />
              <Slider
                label="Fill holes"
                value={session.cleanup.fillHoles}
                min={0}
                max={2048}
                step={8}
                onChange={(fillHoles) => setSegmentationCleanup(node.id, { fillHoles })}
                onReset={() => setSegmentationCleanup(node.id, { fillHoles: 64 })}
                displayFormatter={(value) => `${Math.round(value)}px²`}
              />
              <Slider
                label="Contour detail"
                value={session.cleanup.contourDetail}
                min={0.25}
                max={12}
                step={0.25}
                onChange={(contourDetail) => setSegmentationCleanup(node.id, { contourDetail })}
                onReset={() => setSegmentationCleanup(node.id, { contourDetail: 2 })}
                displayFormatter={(value) => `${value.toFixed(2)}px`}
              />
            </div>
          ) : null}

          {session.mask ? (
            <div className="space-y-2 border-t border-white/[0.08] pt-3">
              <TextInput
                value={maskName}
                onValueChange={setMaskName}
                aria-label="Mask name"
                className="w-full"
              />
              <button
                type="button"
                onClick={() => void acceptMask()}
                disabled={!canAccept || isBusy}
                className="w-full rounded-md bg-primary-600 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? 'Saving mask…' : 'Create editable mask shape'}
              </button>
              <p className="text-[9px] leading-4 text-gray-500">
                Stores the source mask and an editable B-spline contour in this Roto node.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function TrackingSection({
  title,
  icon,
  meta,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <PanelSection className="space-y-2">
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
    </PanelSection>
  );
}

function TrackingPill({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'warning' | 'danger';
}) {
  const overrideClass =
    tone === 'accent'
      ? '!bg-primary-400/[0.12] !text-primary-100'
      : tone === 'warning'
        ? '!bg-amber-500/[0.14] !text-amber-200'
        : tone === 'danger'
          ? '!bg-red-400/[0.11] !text-red-100'
          : '!bg-white/[0.055] !text-gray-300';

  return (
    <Badge size="sm" uppercase variant={tone} className={`font-semibold ${overrideClass}`}>
      {children}
    </Badge>
  );
}

function TrackingActionButton({
  label,
  icon,
  onClick,
  disabled,
  title,
  variant = 'secondary',
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  title: string;
  variant?: 'primary' | 'secondary' | 'smart' | 'danger';
}) {
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
}

const DEFAULT_HYBRID_TRACKING_CONFIG: HybridTrackingConfig = {
  maxError: 15,
  outlierDistance: 30,
  searchRadius: 18,
  patchRadius: 5,
  minimumNccScore: 0.62,
  coherentFallback: true,
};

const DEFAULT_TEMPORAL_TRACKING_CONFIG: TemporalTrackingConfig = {
  mode: 'normal',
  smoothingWindow: 5,
  anomalyThreshold: 12,
  repair: 'blend',
};

function TrackingPanel({ node, onClose }: { node: RotoNode; onClose: () => void }) {
  const nodes = useEditorSelector((s) => s.nodes);
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const selectedRotoLayerIds = useEditorSelector(
    (s) => s.hierarchySelections[s.selectedNodeId ?? '']?.layerIds ?? [],
  );
  const selectedRotoPathIds = useEditorSelector(
    (s) => s.hierarchySelections[s.selectedNodeId ?? '']?.itemIds ?? [],
  );
  const {
    trackRotoSelection,
    smartTrackRotoSelection,
    matchRotoSelectionToCurrentFrame,
    clearRotoTrackingTarget,
    cancelTracking,
  } = useEditorActions();
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
    independentScale: false,
    affine: false,
    perspective: false,
  });
  const [trackDeform, setTrackDeform] = useState(false);
  const [trackerMode, setTrackerMode] = useState<TrackingAlgorithm>('hybrid');
  const [showTrackerSettings, setShowTrackerSettings] = useState(false);
  const [hybridTracking, setHybridTracking] = useState<HybridTrackingConfig>(
    DEFAULT_HYBRID_TRACKING_CONFIG,
  );
  const [temporalTracking, setTemporalTracking] = useState<TemporalTrackingConfig>(
    DEFAULT_TEMPORAL_TRACKING_CONFIG,
  );
  const [targetKind, setTargetKind] = useState<'shape' | 'layer'>(
    trackingScope.defaultTarget?.kind ?? 'shape',
  );

  const handleMotionToggle = (
    field: 'translation' | 'rotation' | 'scale' | 'affine' | 'perspective',
  ) => {
    setMotionModel((prev) => ({
      ...prev,
      ...toggleTransformWithHierarchy(prev, field),
      ...(field === 'translation' ? {} : { independentScale: false }),
    }));
  };
  const toggleIndependentScale = () => {
    setMotionModel((previous) => ({
      ...previous,
      independentScale: !previous.independentScale,
      scale: true,
      rotation: !previous.independentScale ? false : previous.rotation,
      affine: !previous.independentScale ? false : previous.affine,
      perspective: !previous.independentScale ? false : previous.perspective,
    }));
  };
  const updateHybridTracking = (patch: Partial<HybridTrackingConfig>) => {
    setHybridTracking((prev) => ({ ...prev, ...patch }));
  };
  const updateTemporalTracking = (patch: Partial<TemporalTrackingConfig>) => {
    setTemporalTracking((prev) => ({ ...prev, ...patch }));
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
  const matchTemplateFrames = useMemo(
    () => getRotoMatchTemplateFrames(node, trackingScope.sourcePathIds, currentFrame),
    [currentFrame, node, trackingScope.sourcePathIds],
  );
  const hasMatchTemplate =
    matchTemplateFrames.previous !== null || matchTemplateFrames.next !== null;
  const canMatchCurrent = canTrack && hasMatchTemplate;
  const matchCurrentTitle = !hasMatchTemplate
    ? 'Add a manual Roto keyframe before or after the current frame'
    : matchTemplateFrames.hasCurrentKeyframe
      ? `Refine and overwrite the manual shape keyframe at frame ${currentFrame}`
      : matchTemplateFrames.previous !== null && matchTemplateFrames.next !== null
        ? `Match frame ${currentFrame} from nearby keyframes ${matchTemplateFrames.previous} and ${matchTemplateFrames.next}, then bake shape point keyframes`
        : `Match frame ${currentFrame} from keyframe ${matchTemplateFrames.previous ?? matchTemplateFrames.next}, then bake shape point keyframes`;
  const sourceShapeCount = trackingScope.sourcePathIds.length;
  const sourceShapeLabel = `${sourceShapeCount} shape${sourceShapeCount === 1 ? '' : 's'}`;

  useEffect(() => {
    setTargetKind(trackingScope.defaultTarget?.kind ?? 'shape');
  }, [selectionKey, trackingScope.defaultTarget?.kind]);

  useEffect(() => {
    if (!canUseDeform && trackDeform) {
      setTrackDeform(false);
    }
  }, [canUseDeform, trackDeform]);

  const createTrackingConfig = (driftTolerance: number | null): TrackingConfig => ({
    translation: motionModel.translation,
    rotation: motionModel.rotation,
    scale: motionModel.scale,
    independentScale: motionModel.independentScale,
    affine: motionModel.affine,
    perspective: motionModel.perspective,
    deform: trackDeform,
    tracker: trackerMode,
    hybrid: trackerMode === 'hybrid' ? hybridTracking : undefined,
    temporal: temporalTracking,
    driftTolerance,
  });

  const handleTrack = async (direction: 'forward' | 'backward', all: boolean) => {
    if (!sourceId || !effectiveTarget || trackingScope.sourcePathIds.length === 0) return;
    setIsTracking(true);
    try {
      const config = createTrackingConfig(all ? rotoTrackingDriftTolerance : null);
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
        createTrackingConfig(null),
        { runInBackground: rotoTrackingBackgroundEnabled },
      );
    } finally {
      setIsTracking(false);
    }
  };

  const handleMatchCurrent = async () => {
    if (!sourceId || !effectiveTarget || !canMatchCurrent) return;
    setIsTracking(true);
    try {
      await matchRotoSelectionToCurrentFrame(
        node.id,
        trackingScope.sourcePathIds,
        effectiveTarget,
        sourceId,
        createTrackingConfig(rotoTrackingDriftTolerance),
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
    <Panel>
      <PanelHeader title="Track" onClose={onClose} />
      <PanelSectionStack>
        <TrackingSection title="Setup" icon={<Icons.Link className="h-3.5 w-3.5" />}>
          <div className="space-y-3">
            <MediaSourceSelect value={sourceId} options={availableSources} onChange={setSourceId} />

            <div className="space-y-2">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate text-[10px] font-medium text-gray-400">Target</span>
                <TrackingPill tone={effectiveTarget && sourceShapeCount > 0 ? 'accent' : 'warning'}>
                  {sourceShapeLabel}
                </TrackingPill>
              </div>

              <SegmentedControl
                value={targetKind}
                options={[
                  {
                    value: 'shape',
                    label: 'Shape',
                    disabled: !trackingScope.availableTargets.includes('shape'),
                    title: !trackingScope.availableTargets.includes('shape')
                      ? 'Shape target is unavailable for the current selection'
                      : undefined,
                  },
                  {
                    value: 'layer',
                    label: 'Layer',
                    disabled: !trackingScope.availableTargets.includes('layer'),
                    title: !trackingScope.availableTargets.includes('layer')
                      ? 'Layer target is unavailable for the current selection'
                      : undefined,
                  },
                ]}
                onChange={(value) => setTargetKind(value as 'shape' | 'layer')}
              />

              {(effectiveTarget?.kind === 'layer' &&
                isPendingRotoTrackingLayerTarget(effectiveTarget)) ||
              hasTrackingData ? (
                <div className="flex flex-wrap gap-1">
                  {effectiveTarget?.kind === 'layer' &&
                    isPendingRotoTrackingLayerTarget(effectiveTarget) && (
                      <TrackingPill tone="warning">New layer</TrackingPill>
                    )}
                  {hasTrackingData && <TrackingPill tone="accent">Tracked</TrackingPill>}
                </div>
              ) : null}

              {trackingScope.reason && (
                <div
                  role="status"
                  className="rounded-md bg-amber-600/[0.14] px-2 py-1.5 text-[10px] leading-4 text-amber-200/90"
                >
                  {trackingScope.reason}
                </div>
              )}
            </div>
          </div>
        </TrackingSection>

        <TrackingSection
          title="Motion"
          icon={<Icons.Curve className="h-3.5 w-3.5" />}
          meta={
            <button
              type="button"
              onClick={() => setShowTrackerSettings((open) => !open)}
              aria-expanded={showTrackerSettings}
              aria-pressed={showTrackerSettings}
              aria-label={`Tracker settings: ${trackerMode === 'hybrid' ? 'Hybrid' : 'Standard'}`}
              title={`Tracker settings: ${trackerMode === 'hybrid' ? 'Hybrid' : 'Standard'}`}
              className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 transition hover:bg-white/[0.06] hover:text-white ${
                showTrackerSettings ? 'bg-white/[0.07] text-primary-100' : ''
              }`}
            >
              <Icons.Cog className="h-3.5 w-3.5" />
            </button>
          }
        >
          <div className="space-y-1.5">
            <div className={`grid grid-cols-4 gap-1 ${trackDeform ? 'opacity-50' : ''}`}>
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
                label="X/Y"
                active={motionModel.independentScale}
                onClick={toggleIndependentScale}
                disabled={trackDeform}
                title="Independent horizontal and vertical scale"
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

            {showTrackerSettings && (
              <div className="space-y-2 rounded-md border border-white/10 bg-gray-950/35 p-2">
                <SegmentedControl
                  value={trackerMode}
                  options={[
                    { value: 'standard_lk', label: 'Standard' },
                    { value: 'hybrid', label: 'Hybrid' },
                  ]}
                  onChange={(value) => setTrackerMode(value as TrackingAlgorithm)}
                />

                <div className="grid grid-cols-2 gap-1">
                  <TrackingPill tone={trackerMode === 'standard_lk' ? 'accent' : 'neutral'}>
                    LK Only
                  </TrackingPill>
                  <TrackingPill tone={trackerMode === 'hybrid' ? 'accent' : 'neutral'}>
                    LK + Patch
                  </TrackingPill>
                </div>

                {trackerMode === 'hybrid' && (
                  <div className="space-y-2">
                    <Slider
                      label="Max Err"
                      value={hybridTracking.maxError}
                      min={2}
                      max={50}
                      step={0.5}
                      onChange={(value) => updateHybridTracking({ maxError: value })}
                      onReset={() =>
                        updateHybridTracking({
                          maxError: DEFAULT_HYBRID_TRACKING_CONFIG.maxError,
                        })
                      }
                      displayFormatter={(value) => value.toFixed(1)}
                    />
                    <Slider
                      label="Outlier"
                      value={hybridTracking.outlierDistance}
                      min={4}
                      max={96}
                      step={1}
                      onChange={(value) => updateHybridTracking({ outlierDistance: value })}
                      onReset={() =>
                        updateHybridTracking({
                          outlierDistance: DEFAULT_HYBRID_TRACKING_CONFIG.outlierDistance,
                        })
                      }
                      displayFormatter={(value) => `${value.toFixed(0)}px`}
                    />
                    <Slider
                      label="Search"
                      value={hybridTracking.searchRadius}
                      min={4}
                      max={64}
                      step={1}
                      onChange={(value) => updateHybridTracking({ searchRadius: value })}
                      onReset={() =>
                        updateHybridTracking({
                          searchRadius: DEFAULT_HYBRID_TRACKING_CONFIG.searchRadius,
                        })
                      }
                      displayFormatter={(value) => `${value.toFixed(0)}px`}
                    />
                    <Slider
                      label="Patch"
                      value={hybridTracking.patchRadius}
                      min={2}
                      max={12}
                      step={1}
                      onChange={(value) => updateHybridTracking({ patchRadius: value })}
                      onReset={() =>
                        updateHybridTracking({
                          patchRadius: DEFAULT_HYBRID_TRACKING_CONFIG.patchRadius,
                        })
                      }
                      displayFormatter={(value) => `${value.toFixed(0)}px`}
                    />
                    <Slider
                      label="NCC"
                      value={hybridTracking.minimumNccScore}
                      min={0.2}
                      max={0.95}
                      step={0.01}
                      onChange={(value) => updateHybridTracking({ minimumNccScore: value })}
                      onReset={() =>
                        updateHybridTracking({
                          minimumNccScore: DEFAULT_HYBRID_TRACKING_CONFIG.minimumNccScore,
                        })
                      }
                      displayFormatter={(value) => value.toFixed(2)}
                    />
                    <ToggleButton
                      label="Coherent"
                      active={hybridTracking.coherentFallback}
                      onClick={() =>
                        updateHybridTracking({
                          coherentFallback: !hybridTracking.coherentFallback,
                        })
                      }
                      title="Use coherent fallback"
                      icon={<Icons.OffsetRing className="h-4 w-4" />}
                    />
                  </div>
                )}

                <div className="space-y-2 rounded-md border border-white/10 bg-white/[0.03] p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase text-gray-400">
                      Temporal
                    </span>
                    <TrackingPill tone={temporalTracking.mode === 'off' ? 'neutral' : 'accent'}>
                      Guard
                    </TrackingPill>
                  </div>
                  <SegmentedControl
                    value={temporalTracking.mode}
                    options={[
                      { value: 'off', label: 'Off' },
                      { value: 'normal', label: 'Normal' },
                      { value: 'strong', label: 'Strong' },
                    ]}
                    onChange={(value) =>
                      updateTemporalTracking({ mode: value as TemporalTrackingMode })
                    }
                  />

                  {temporalTracking.mode !== 'off' && (
                    <div className="space-y-2">
                      <SegmentedControl
                        value={temporalTracking.repair}
                        options={[
                          { value: 'blend', label: 'Blend' },
                          { value: 'predict', label: 'Predict' },
                        ]}
                        onChange={(value) =>
                          updateTemporalTracking({ repair: value as TemporalTrackingRepair })
                        }
                      />
                      <Slider
                        label="Window"
                        value={temporalTracking.smoothingWindow}
                        min={3}
                        max={11}
                        step={2}
                        onChange={(value) => updateTemporalTracking({ smoothingWindow: value })}
                        onReset={() =>
                          updateTemporalTracking({
                            smoothingWindow: DEFAULT_TEMPORAL_TRACKING_CONFIG.smoothingWindow,
                          })
                        }
                        displayFormatter={(value) => `${value.toFixed(0)}f`}
                      />
                      <Slider
                        label="Spike"
                        value={temporalTracking.anomalyThreshold}
                        min={4}
                        max={48}
                        step={1}
                        onChange={(value) => updateTemporalTracking({ anomalyThreshold: value })}
                        onReset={() =>
                          updateTemporalTracking({
                            anomalyThreshold: DEFAULT_TEMPORAL_TRACKING_CONFIG.anomalyThreshold,
                          })
                        }
                        displayFormatter={(value) => `${value.toFixed(0)}px`}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
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
                value={rotoTrackingDriftTolerance ?? RotoTrackingDriftTolerance.OVERFLOW}
                min={RotoTrackingDriftTolerance.MIN}
                max={RotoTrackingDriftTolerance.MAX}
                step={RotoTrackingDriftTolerance.STEP}
                overflowLabel="∞"
                onChange={(value) =>
                  setPreferences({
                    rotoTrackingDriftTolerance:
                      value >= RotoTrackingDriftTolerance.OVERFLOW ? null : value,
                  })
                }
                onReset={() =>
                  setPreferences({
                    rotoTrackingDriftTolerance: RotoTrackingDriftTolerance.DEFAULT,
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

            <TrackingActionButton
              label="Match Current"
              icon={<Icons.Sparkles className="h-3.5 w-3.5" />}
              onClick={handleMatchCurrent}
              disabled={!canMatchCurrent}
              title={matchCurrentTitle}
              variant="smart"
            />

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
                title="Fill the range between surrounding keyframes"
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
      </PanelSectionStack>
    </Panel>
  );
}

function MotionCuePanel({ node, onClose }: { node: RotoNode; onClose: () => void }) {
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
    <Panel>
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
}

function RotoToolPanels({
  node,
  openPanels,
  onPanelClose,
}: {
  node: AnyNode;
  openPanels: ReadonlySet<string>;
  onPanelClose: (panel: string) => void;
}) {
  const rotoNode = node as RotoNode;

  return (
    <>
      {openPanels.has('nudge') && <NudgePanel onClose={() => onPanelClose('nudge')} />}
      {openPanels.has('trace') && (
        <AutoTracePanel node={rotoNode} onClose={() => onPanelClose('trace')} />
      )}
      {openPanels.has('segmentation') && (
        <SmartMaskPanel node={rotoNode} onClose={() => onPanelClose('segmentation')} />
      )}
      {openPanels.has('part-separation') && (
        <RotoPartSeparationPanel node={rotoNode} onClose={() => onPanelClose('part-separation')} />
      )}
      {openPanels.has('tracking') && (
        <TrackingPanel node={rotoNode} onClose={() => onPanelClose('tracking')} />
      )}
      {openPanels.has('motion-cue') && (
        <MotionCuePanel node={rotoNode} onClose={() => onPanelClose('motion-cue')} />
      )}
    </>
  );
}

export default RotoToolPanels;
