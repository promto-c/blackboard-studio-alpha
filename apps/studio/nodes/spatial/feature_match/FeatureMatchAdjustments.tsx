import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  AnyNode,
  FeatureMatchNode,
  MatchMoveSolveModel,
  ProjectColorManagement,
} from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { CollapsibleSection, IconButton, Slider } from '@blackboard/ui';
import { ExecuteButton, SegmentedControl } from '@/components';
import { useNodeExecutionHandler } from '@/hooks/useNodeExecutionHandler';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { renderWithSharedPipeline } from '@/renderer/pipeline';
import { detectMatchMoveFeatures, type MatchMovePixelFrame } from '@/utils/matchMoveTracking';
import {
  buildOpticalFlowPyramid,
  calculateOpticalFlowFromPyramids,
  fitTrackedTransform,
} from '@/utils/opticalFlow';
import { readRenderTargetRgbaFloat } from '@blackboard/renderer';
import { invertMatrix3 } from './featureMatchGpu';
import { findSceneNode } from '@/utils/graphCommands';

const MINI_LABEL_CLASS = 'text-[9px] font-semibold uppercase tracking-[0.12em] text-gray-500';

const solveModelOptions = [
  { value: 'translation', label: 'Move' },
  { value: 'similarity', label: 'TRS' },
  { value: 'affine', label: 'Affine' },
  { value: 'homography', label: 'Planar' },
];

const formatNumber = (value: number | undefined, digits = 2): string =>
  Number.isFinite(value) ? (value as number).toFixed(digits) : '-';

/**
 * Compute a 3x3 identity matrix.
 */
const identity3x3 = (): number[][] => [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/**
 * Convert a solved transform model type to the config format expected by fitTrackedTransform.
 */
const solveModelToConfig = (model: MatchMoveSolveModel, ransacThreshold?: number) => ({
  translation: true,
  rotation: model !== 'translation',
  scale: model !== 'translation',
  affine: model === 'affine' || model === 'homography',
  perspective: model === 'homography',
  deform: false,
  ransacThreshold,
});

/**
 * Convert a solved transform model into a 3x3 matrix.
 */
function solvedModelToMatrix(solved: { type: string; model: number[] } | null): number[][] {
  if (!solved) return identity3x3();

  if (solved.type === 'homography') {
    const m = solved.model;
    return [
      [m[0], m[1], m[2]],
      [m[3], m[4], m[5]],
      [m[6], m[7], m[8]],
    ];
  }

  if (solved.type === 'affine') {
    const m = solved.model;
    return [
      [m[0], m[1], m[2]],
      [m[3], m[4], m[5]],
      [0, 0, 1],
    ];
  }

  if (solved.type === 'similarity') {
    const m = solved.model;
    return [
      [m[0], -m[1], m[2]],
      [m[1], m[0], m[3]],
      [0, 0, 1],
    ];
  }

  if (solved.type === 'independent_scale') {
    const m = solved.model;
    return [
      [m[0], 0, m[1]],
      [0, m[2], m[3]],
      [0, 0, 1],
    ];
  }

  // Translation
  return [
    [1, 0, solved.model[0]],
    [0, 1, solved.model[1]],
    [0, 0, 1],
  ];
}

/**
 * Render pixel data capture of a specific node output onto a WebGLRenderTarget,
 * read it back, and return as a pixel frame.
 */
async function captureNodeOutput(
  nodeId: string,
  portName: string,
  allNodes: AnyNode[],
  sceneNode: AnyNode | undefined,
  frame: number,
  projectColorManagement: ProjectColorManagement,
): Promise<MatchMovePixelFrame | null> {
  if (!sceneNode) return null;

  try {
    const result = await renderWithSharedPipeline({
      captureOutputs: [{ id: 'output', nodeId, sourcePort: portName }],
      nodes: allNodes,
      sceneNode: sceneNode as Parameters<typeof renderWithSharedPipeline>[0]['sceneNode'],
      frame,
      width: (sceneNode as { width: number }).width,
      height: (sceneNode as { height: number }).height,
      finalColorSpace: 'scene_linear',
      textureCacheMode: 'persistent',
      presentToCanvas: false,
      keepRendererAlive: true,
      projectColorManagement,
    });

    const target = result.capturedOutputTargets.get('output');
    if (!target) {
      result.dispose();
      return null;
    }

    const floatPixels = readRenderTargetRgbaFloat(result.renderer, target);
    result.dispose();

    // Convert float32 to uint8 for feature detection
    const pixels = new Uint8ClampedArray(floatPixels.length);
    for (let i = 0; i < floatPixels.length; i++) {
      pixels[i] = Math.round(Math.max(0, Math.min(1, floatPixels[i])) * 255);
    }

    return { data: pixels, width: target.width, height: target.height };
  } catch {
    return null;
  }
}

function FeatureMatchAdjustments({ node: anyNode }: { node: AnyNode }) {
  const node = anyNode as FeatureMatchNode;
  const nodes = useEditorSelector((state) => state.nodes);
  const currentFrame = useEditorSelector((state) => state.currentFrame);
  const projectColorManagement = useEditorSelector((state) => state.colorManagement);
  const actions = useEditorActions();
  const abortRef = useRef<AbortController | null>(null);
  const [runState, setRunState] = useState<{
    running: boolean;
    progress: number;
    detail: string;
  }>({ running: false, progress: 0, detail: '' });

  const sceneNode = useMemo(() => findSceneNode(nodes), [nodes]);

  const commitSettings = useCallback(
    (patch: Partial<FeatureMatchNode['settings']>) => {
      actions.updateNode(node.id, { settings: { ...node.settings, ...patch } }, true);
    },
    [actions, node.id, node.settings],
  );

  const clearResult = useCallback(() => {
    actions.updateNode(
      node.id,
      {
        result: {
          status: 'idle',
          matrix: identity3x3(),
          invMatrix: identity3x3(),
          model: node.settings.model,
          inliers: 0,
          totalPoints: 0,
          residual: 0,
        },
      },
      true,
    );
  }, [actions, node.id, node.settings.model]);

  const runMatching = useCallback(async () => {
    if (runState.running) {
      abortRef.current?.abort();
      return;
    }

    const sourceNodeId = node.inputs?.pipe;
    const refNodeId = node.inputs?.reference;

    if (!sourceNodeId || !refNodeId) {
      actions.updateNode(
        node.id,
        {
          result: {
            status: 'failed',
            message: 'Both Source and Reference inputs must be connected.',
            matrix: identity3x3(),
            invMatrix: identity3x3(),
            model: node.settings.model,
            inliers: 0,
            totalPoints: 0,
            residual: 0,
          },
        },
        true,
      );
      return;
    }

    if (!sceneNode) {
      actions.updateNode(
        node.id,
        {
          result: {
            status: 'failed',
            message: 'No scene node found.',
            matrix: identity3x3(),
            invMatrix: identity3x3(),
            model: node.settings.model,
            inliers: 0,
            totalPoints: 0,
            residual: 0,
          },
        },
        true,
      );
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setRunState({ running: true, progress: 5, detail: 'Rendering inputs...' });

    try {
      setRunState({ running: true, progress: 10, detail: 'Rendering source input...' });
      const sourcePixels = await captureNodeOutput(
        sourceNodeId,
        'output',
        nodes,
        sceneNode,
        currentFrame,
        projectColorManagement,
      );
      if (!sourcePixels || controller.signal.aborted) {
        throw new Error('Could not read source input pixels.');
      }

      setRunState({ running: true, progress: 25, detail: 'Rendering reference input...' });
      const refPixels = await captureNodeOutput(
        refNodeId,
        'output',
        nodes,
        sceneNode,
        currentFrame,
        projectColorManagement,
      );
      if (!refPixels || controller.signal.aborted) {
        throw new Error('Could not read reference input pixels.');
      }

      if (controller.signal.aborted) return;

      setRunState({ running: true, progress: 40, detail: 'Detecting features in reference...' });
      const features = detectMatchMoveFeatures(refPixels, {
        maxFeatures: node.settings.maxFeatures,
        minFeatureDistance: node.settings.minFeatureDistance,
        featureQuality: node.settings.featureQuality,
        patchSize: node.settings.patchSize,
      });

      if (features.length === 0) {
        throw new Error('No trackable features found in the reference image.');
      }

      setRunState({
        running: true,
        progress: 55,
        detail: `Building pyramids and tracking ${features.length} features...`,
      });

      // Build pyramids for both images
      const sourcePyramid = buildOpticalFlowPyramid(
        sourcePixels.data,
        sourcePixels.width,
        sourcePixels.height,
      );
      const refPyramid = buildOpticalFlowPyramid(refPixels.data, refPixels.width, refPixels.height);

      // Track features from reference → source
      const trackedPoints = calculateOpticalFlowFromPyramids(
        refPyramid,
        sourcePyramid,
        features.map((f) => ({ x: f.x, y: f.y })),
      );

      setRunState({ running: true, progress: 80, detail: 'Solving transform...' });

      // Filter valid tracked points
      const referencePoints: { x: number; y: number }[] = [];
      const trackedValidPoints: { x: number; y: number }[] = [];

      features.forEach((feature, index) => {
        const tracked = trackedPoints[index];
        if (
          tracked &&
          Number.isFinite(tracked.x) &&
          Number.isFinite(tracked.y) &&
          tracked.error < node.settings.maxTrackError
        ) {
          referencePoints.push({ x: feature.x, y: feature.y });
          trackedValidPoints.push({ x: tracked.x, y: tracked.y });
        }
      });

      const minPoints =
        node.settings.model === 'homography' ? 4 : node.settings.model === 'affine' ? 3 : 2;
      if (referencePoints.length < minPoints) {
        throw new Error(
          `Not enough matched features (${referencePoints.length}/${minPoints} minimum for ${node.settings.model}).`,
        );
      }

      // Solve for transform: maps reference → source
      const solved = fitTrackedTransform(
        referencePoints,
        trackedValidPoints,
        solveModelToConfig(node.settings.model, node.settings.ransacThreshold),
      );

      if (!solved) {
        throw new Error(
          'Failed to solve transform. Try a simpler model or adjust RANSAC threshold.',
        );
      }

      const matrix = solvedModelToMatrix(solved);

      // Compute the inverse for warping source → reference
      const invMatrix = invertMatrix3(matrix) ?? identity3x3();

      // Compute residuals
      let totalResidual = 0;
      for (let i = 0; i < referencePoints.length; i++) {
        const refPt = referencePoints[i];
        const srcPt = trackedValidPoints[i];
        const dx = srcPt.x - refPt.x;
        const dy = srcPt.y - refPt.y;
        totalResidual += Math.sqrt(dx * dx + dy * dy);
      }
      const avgResidual = referencePoints.length > 0 ? totalResidual / referencePoints.length : 0;

      setRunState({ running: true, progress: 95, detail: 'Storing result...' });

      actions.updateNode(
        node.id,
        {
          result: {
            status: 'solved',
            matrix,
            invMatrix,
            model: solved.type as MatchMoveSolveModel,
            inliers: referencePoints.length,
            totalPoints: features.length,
            residual: avgResidual,
            sourceWidth: sourcePixels.width,
            sourceHeight: sourcePixels.height,
          },
        },
        true,
      );

      setRunState({ running: false, progress: 100, detail: 'Done' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Matching failed.';
      actions.updateNode(
        node.id,
        {
          result: {
            status: 'failed',
            message,
            matrix: identity3x3(),
            invMatrix: identity3x3(),
            model: node.settings.model,
            inliers: 0,
            totalPoints: 0,
            residual: 0,
          },
        },
        true,
      );
    } finally {
      abortRef.current = null;
      if (!controller.signal.aborted) {
        setRunState({ running: false, progress: 0, detail: '' });
      }
    }
  }, [
    runState.running,
    node.inputs?.pipe,
    node.inputs?.reference,
    node.settings.model,
    node.settings.ransacThreshold,
    node.settings.maxFeatures,
    node.settings.minFeatureDistance,
    node.settings.featureQuality,
    node.settings.patchSize,
    node.settings.maxTrackError,
    node.id,
    sceneNode,
    nodes,
    currentFrame,
    projectColorManagement,
    actions,
  ]);

  useNodeExecutionHandler(node.id, runMatching);

  const result = node.result;
  const isSolved = result.status === 'solved';
  const isIdle = result.status === 'idle';
  const isFailed = result.status === 'failed';

  const statusClassName = isSolved
    ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200'
    : isFailed
      ? 'border-red-400/25 bg-red-500/10 text-red-100'
      : 'border-white/10 bg-white/[0.04] text-gray-300';

  const statusLabelText = isSolved ? 'Solved' : isFailed ? 'Failed' : 'Idle';

  const hasSource = !!node.inputs?.pipe;
  const hasRef = !!node.inputs?.reference;
  const canRun = hasSource && hasRef && !runState.running;

  return (
    <div className="space-y-3">
      <div className={`rounded-md border px-3 py-2 ${statusClassName}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold">{statusLabelText}</div>
            <div className="truncate text-[10px] opacity-75">
              {!hasSource
                ? 'Connect Source (left)'
                : !hasRef
                  ? 'Connect Reference (right)'
                  : (result.message ?? `${result.inliers} inliers / ${result.totalPoints} points`)}
            </div>
          </div>
          {isSolved ? (
            <div className="shrink-0 font-mono text-[10px] opacity-80">
              {result.inliers}/{result.totalPoints} pts
            </div>
          ) : null}
        </div>
        {result.message && (isFailed || isIdle) ? (
          <div className="mt-1 text-[10px] leading-4 opacity-80">{result.message}</div>
        ) : null}
      </div>

      <CollapsibleSection title="Settings" defaultOpen>
        <div className="space-y-4">
          <div className="space-y-2">
            <div className={MINI_LABEL_CLASS}>Model</div>
            <SegmentedControl
              options={solveModelOptions}
              value={node.settings.model}
              onChange={(value) => commitSettings({ model: value as MatchMoveSolveModel })}
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <Slider
              label="RANSAC"
              value={node.settings.ransacThreshold}
              min={0.25}
              max={20}
              step={0.25}
              onChange={(value) => commitSettings({ ransacThreshold: value })}
              displayFormatter={(value) => value.toFixed(2)}
            />
            <Slider
              label="Features"
              value={node.settings.maxFeatures}
              min={12}
              max={800}
              step={1}
              onChange={(value) => commitSettings({ maxFeatures: Math.round(value) })}
              displayFormatter={(value) => String(Math.round(value))}
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <Slider
              label="Spacing"
              value={node.settings.minFeatureDistance}
              min={6}
              max={96}
              step={1}
              onChange={(value) => commitSettings({ minFeatureDistance: Math.round(value) })}
              displayFormatter={(value) => `${Math.round(value)}px`}
            />
            <Slider
              label="Quality"
              value={node.settings.featureQuality}
              min={0.005}
              max={0.2}
              step={0.005}
              onChange={(value) => commitSettings({ featureQuality: value })}
              displayFormatter={(value) => value.toFixed(3)}
            />
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Result" defaultOpen={isSolved}>
        {isSolved ? (
          <div className="grid grid-cols-2 gap-1.5">
            <div className="min-w-0 rounded-md bg-gray-950/40 px-2 py-1.5">
              <div className={MINI_LABEL_CLASS}>Residual</div>
              <div className="truncate font-mono text-xs text-gray-100">
                {formatNumber(result.residual)}
              </div>
            </div>
            <div className="min-w-0 rounded-md bg-gray-950/40 px-2 py-1.5">
              <div className={MINI_LABEL_CLASS}>Inliers</div>
              <div className="truncate font-mono text-xs text-gray-100">
                {result.inliers} / {result.totalPoints}
              </div>
            </div>
            <div className="min-w-0 rounded-md bg-gray-950/40 px-2 py-1.5">
              <div className={MINI_LABEL_CLASS}>Model</div>
              <div className="truncate font-mono text-xs text-gray-100">{result.model}</div>
            </div>
            <div className="min-w-0 rounded-md bg-gray-950/40 px-2 py-1.5">
              <div className={MINI_LABEL_CLASS}>Dimension</div>
              <div className="truncate font-mono text-xs text-gray-100">
                {result.sourceWidth ?? '-'} × {result.sourceHeight ?? '-'}
              </div>
            </div>
          </div>
        ) : (
          <div className="py-2 text-center text-[10px] text-gray-500">
            Run Feature Match to see results
          </div>
        )}
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
          disabled={!canRun && !runState.running}
          onClick={runMatching}
          title={runState.running ? 'Cancel matching' : 'Detect features and solve transform'}
          icon={
            runState.running ? <Icons.XMark className="h-3.5 w-3.5 text-primary-200" /> : undefined
          }
        >
          {runState.running ? 'Cancel' : 'Match and Transform'}
        </ExecuteButton>
        <IconButton
          icon={Icons.Trash}
          tooltip="Clear matching result"
          onClick={clearResult}
          className="h-8 w-8 border border-white/10 bg-white/[0.04] text-gray-400 hover:bg-white/[0.08] hover:text-gray-100"
        />
      </div>
    </div>
  );
}

export default FeatureMatchAdjustments;
