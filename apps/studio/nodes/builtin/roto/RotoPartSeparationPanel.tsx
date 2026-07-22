import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { RotoPartSeparationResult } from '@/utils/rotoPartSeparation';
import { separateRotoMaskIntoParts, simplifyRotoPartContour } from '@/utils/rotoPartSeparation';
import { measureRotoPartVectorFit } from '@/utils/rotoPartVectorFit';
import type { RotoNode, RotoPath } from '@blackboard/types';
import { Badge, Slider } from '@blackboard/ui';
import { ViewportToolPanel as Panel, ViewportToolPanelHeader as PanelHeader } from '@/components';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { findSceneNode } from '@/utils/graphCommands';
import {
  getRotoControlOwnershipSamples,
  rasterizeRotoShapeForAnalysis,
  sceneDistanceToRasterDistance,
  scenePointToRasterPoint,
} from '@/utils/rotoShapeRaster';
import { resolveRotoPathPointsAtFrame } from '@/utils/rotoTracking';
import {
  clearRotoPartSeparationPreview,
  ROTO_PART_PREVIEW_COLORS,
  setRotoPartSeparationPreview,
} from '@/services/segmentation/rotoPartSeparationPreview';

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function PartsPreview({ result }: { result: RotoPartSeparationResult }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || result.parts.length === 0) return;
    canvas.width = result.width;
    canvas.height = result.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    const image = context.createImageData(result.width, result.height);

    for (let index = 0; index < result.sourceMask.length; index += 1) {
      if (result.sourceMask[index] === 0) continue;
      let red = 0;
      let green = 0;
      let blue = 0;
      let memberships = 0;
      result.parts.forEach((part) => {
        if (part.mask[index] === 0) return;
        const color = ROTO_PART_PREVIEW_COLORS[part.index % ROTO_PART_PREVIEW_COLORS.length];
        red += color[0];
        green += color[1];
        blue += color[2];
        memberships += 1;
      });
      const offset = index * 4;
      if (memberships > 0) {
        const overlapLift = memberships > 1 ? 28 : 0;
        image.data[offset] = Math.min(255, red / memberships + overlapLift);
        image.data[offset + 1] = Math.min(255, green / memberships + overlapLift);
        image.data[offset + 2] = Math.min(255, blue / memberships + overlapLift);
        image.data[offset + 3] = 220;
      }
    }
    context.putImageData(image, 0, 0);

    const radius = Math.max(2, Math.min(result.width, result.height) / 90);
    result.parts.forEach((part) => {
      const color = ROTO_PART_PREVIEW_COLORS[part.index % ROTO_PART_PREVIEW_COLORS.length];
      context.beginPath();
      context.arc(part.seed.x, part.seed.y, radius, 0, Math.PI * 2);
      context.fillStyle = `rgb(${color.join(' ')})`;
      context.fill();
      context.lineWidth = Math.max(1, radius / 2);
      context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      context.stroke();
    });
  }, [result]);

  return (
    <div className="overflow-hidden rounded-md border border-white/10 bg-[linear-gradient(45deg,#171717_25%,transparent_25%),linear-gradient(-45deg,#171717_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#171717_75%),linear-gradient(-45deg,transparent_75%,#171717_75%)] bg-[length:12px_12px] bg-[position:0_0,0_6px,6px_-6px,-6px_0px]">
      <canvas
        ref={canvasRef}
        aria-label="Separated shape parts preview"
        className="mx-auto block max-h-44 max-w-full"
      />
    </div>
  );
}

const formatFitPercent = (value: number): string => {
  if (value >= 99.95) return '100%';
  if (value < 0.05) return '0%';
  return `${value.toFixed(1)}%`;
};

function SelectedShapeHint() {
  return (
    <div className="rounded-md border border-amber-400/20 bg-amber-500/[0.08] p-2.5 text-[10px] leading-4 text-amber-100">
      Select one closed Roto shape. Polygons and B-splines can be separated directly; no Smart Mask
      or stored raster is required.
    </div>
  );
}

export function RotoPartSeparationPanel({
  node,
  onClose,
}: {
  node: RotoNode;
  onClose: () => void;
}) {
  const selectedPathIds = useEditorSelector(
    (state) => state.hierarchySelections[node.id]?.itemIds ?? [],
  );
  const nodes = useEditorSelector((state) => state.nodes);
  const currentFrame = useEditorSelector((state) => state.currentFrame);
  const { separateRotoShapeParts } = useEditorActions();
  const selectedPath: RotoPath | null = useMemo(() => {
    if (selectedPathIds.length !== 1) return null;
    return node.paths.find((path) => path.id === selectedPathIds[0]) ?? null;
  }, [node.paths, selectedPathIds]);
  const sourcePath = selectedPath?.closed ? selectedPath : null;
  const sceneNode = useMemo(() => findSceneNode(nodes), [nodes]);
  const [partCountOverride, setPartCountOverride] = useState<number | null>(null);
  const [overlap, setOverlap] = useState(8);
  const [branchReach, setBranchReach] = useState(2.5);
  const deferredPartCountOverride = useDeferredValue(partCountOverride);
  const deferredOverlap = useDeferredValue(overlap);
  const deferredBranchReach = useDeferredValue(branchReach);
  const isPreviewPending =
    deferredPartCountOverride !== partCountOverride ||
    deferredOverlap !== overlap ||
    deferredBranchReach !== branchReach;
  const [isCreating, setIsCreating] = useState(false);
  const [actionError, setActionError] = useState<{ pathId: string; message: string } | null>(null);
  const previewOwnerIdRef = useRef(
    `roto-parts-${node.id}-${Math.random().toString(36).slice(2, 10)}`,
  );

  const analysis = useMemo(() => {
    if (!sourcePath) return { raster: null, sourceGeometry: null, error: null };
    if (!sceneNode) {
      return {
        raster: null,
        sourceGeometry: null,
        error: 'A scene is required to analyze this shape.',
      };
    }
    try {
      const raster = rasterizeRotoShapeForAnalysis(node, sourcePath, currentFrame, sceneNode);
      const resolvedSourcePoints = resolveRotoPathPointsAtFrame(node, sourcePath, currentFrame);
      return {
        raster,
        sourceGeometry: raster
          ? {
              points: resolvedSourcePoints.map((point) => scenePointToRasterPoint(raster, point)),
              pointTypes: sourcePath.pointTypes,
              ownershipSamples: getRotoControlOwnershipSamples(
                sourcePath,
                resolvedSourcePoints,
              ).map((samples) => samples.map((point) => scenePointToRasterPoint(raster, point))),
            }
          : null,
        error: raster ? null : 'The closed shape needs at least three valid points.',
      };
    } catch (rasterError) {
      return { raster: null, sourceGeometry: null, error: getErrorMessage(rasterError) };
    }
  }, [currentFrame, node, sceneNode, sourcePath]);
  const error =
    analysis.error ??
    (actionError && sourcePath && actionError.pathId === sourcePath.id
      ? actionError.message
      : null);

  useEffect(() => setPartCountOverride(null), [sourcePath?.id]);

  const automaticPreview = useMemo(() => {
    const raster = analysis.raster;
    if (!raster) return null;
    return separateRotoMaskIntoParts(
      raster.mask,
      raster.width,
      raster.height,
      {
        partCount: 'auto',
        overlap: deferredOverlap,
        branchReach: deferredBranchReach,
      },
      analysis.sourceGeometry ?? undefined,
    );
  }, [analysis.raster, analysis.sourceGeometry, deferredBranchReach, deferredOverlap]);
  const preview = useMemo(() => {
    const raster = analysis.raster;
    if (!raster || deferredPartCountOverride === null) return automaticPreview;
    return separateRotoMaskIntoParts(
      raster.mask,
      raster.width,
      raster.height,
      {
        partCount: deferredPartCountOverride,
        overlap: deferredOverlap,
        branchReach: deferredBranchReach,
      },
      analysis.sourceGeometry ?? undefined,
    );
  }, [
    analysis.raster,
    analysis.sourceGeometry,
    automaticPreview,
    deferredBranchReach,
    deferredOverlap,
    deferredPartCountOverride,
  ]);
  const displayedPartCount = Math.max(
    2,
    Math.min(16, partCountOverride ?? automaticPreview?.parts.length ?? 2),
  );
  const fittedPreviewParts = useMemo(() => {
    if (!preview || !analysis.raster || !sourcePath) return [];
    const previewTolerance = sceneDistanceToRasterDistance(
      analysis.raster,
      Math.max(0.25, sourcePath.epsilon ?? 2),
    );
    return preview.parts.map((part) => {
      const simplified = simplifyRotoPartContour(
        part.editableContour,
        part.editablePointTypes,
        previewTolerance,
        part.editablePointOrigins,
      );
      return {
        index: part.index,
        seed: part.seed,
        contour: simplified.points,
        pointTypes: simplified.pointTypes,
        corePixelCount: part.corePixelCount,
        pixelCount: part.pixelCount,
      };
    });
  }, [analysis.raster, preview, sourcePath]);
  const vectorFitMetrics = useMemo(
    () =>
      preview
        ? measureRotoPartVectorFit(
            preview,
            fittedPreviewParts.map((part) => ({
              index: part.index,
              points: part.contour,
              pointTypes: part.pointTypes,
            })),
          )
        : null,
    [fittedPreviewParts, preview],
  );
  const coverageTone =
    !vectorFitMetrics || vectorFitMetrics.sourceCoveragePercent >= 99
      ? 'text-emerald-300'
      : vectorFitMetrics.sourceCoveragePercent >= 97
        ? 'text-amber-300'
        : 'text-rose-300';
  const outsideTone =
    !vectorFitMetrics || vectorFitMetrics.outsideSourcePercent <= 1
      ? 'text-emerald-300'
      : vectorFitMetrics.outsideSourcePercent <= 3
        ? 'text-amber-300'
        : 'text-rose-300';

  useEffect(() => {
    const ownerId = previewOwnerIdRef.current;
    if (!preview || !analysis.raster || !sourcePath || fittedPreviewParts.length === 0) {
      clearRotoPartSeparationPreview(node.id, ownerId);
      return () => undefined;
    }

    setRotoPartSeparationPreview({
      ownerId,
      nodeId: node.id,
      sourcePathId: sourcePath.id,
      sourceFrame: currentFrame,
      width: preview.width,
      height: preview.height,
      sceneBounds: analysis.raster.sceneBounds,
      partCount: preview.parts.length,
      overlap: deferredOverlap,
      branchReach: deferredBranchReach,
      parts: fittedPreviewParts,
    });

    return () => clearRotoPartSeparationPreview(node.id, ownerId);
  }, [
    analysis.raster,
    currentFrame,
    deferredBranchReach,
    deferredOverlap,
    fittedPreviewParts,
    node.id,
    preview,
    sourcePath,
  ]);

  const createParts = async () => {
    if (!sourcePath) return;
    setIsCreating(true);
    setActionError(null);
    try {
      const ids = await separateRotoShapeParts(node.id, sourcePath.id, {
        partCount: partCountOverride ?? 'auto',
        overlap,
        branchReach,
      });
      if (!ids || ids.length < 2) throw new Error('No editable parts were created.');
      onClose();
    } catch (createError) {
      setActionError({ pathId: sourcePath.id, message: getErrorMessage(createError) });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Panel>
      <PanelHeader title="Separate Parts" onClose={onClose} />
      <div className="space-y-3">
        {!sourcePath ? (
          <SelectedShapeHint />
        ) : (
          <>
            <div className="rounded-md border border-sky-400/15 bg-sky-400/[0.06] p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-semibold text-sky-100">
                    {selectedPath.name}
                  </p>
                  <p className="mt-0.5 text-[9px] leading-4 text-gray-400">
                    Live vector analysis · frame {currentFrame} · no mask asset
                  </p>
                </div>
                <Badge size="sm" uppercase variant="neutral">
                  {preview
                    ? `${partCountOverride === null ? 'Auto · ' : ''}${preview.parts.length} parts`
                    : 'Shape'}
                </Badge>
              </div>
            </div>

            <div
              className={isPreviewPending ? 'opacity-55 transition-opacity' : 'transition-opacity'}
            >
              {preview ? <PartsPreview result={preview} /> : null}
            </div>

            <Slider
              label="Parts"
              value={displayedPartCount}
              min={2}
              max={16}
              step={1}
              onChange={(value) => setPartCountOverride(Math.round(value))}
              onReset={() => setPartCountOverride(null)}
              displayFormatter={(value) => `${Math.round(value)}`}
            />
            <p className="-mt-2 text-[9px] leading-4 text-gray-500">
              Starts at the detected part count. Reset returns to automatic detection.
            </p>
            <Slider
              label="Branch reach"
              value={branchReach}
              min={1}
              max={5}
              step={0.1}
              onChange={setBranchReach}
              onReset={() => setBranchReach(2.5)}
              displayFormatter={(value) => `${value.toFixed(1)}×`}
            />
            <p className="-mt-2 text-[9px] leading-4 text-gray-500">
              Joints start at detected narrow necks. Higher values move them deeper into the core.
            </p>
            <Slider
              label="Underlap"
              value={overlap}
              min={0}
              max={32}
              step={1}
              onChange={setOverlap}
              onReset={() => setOverlap(8)}
              displayFormatter={(value) => `${Math.round(value)} px`}
            />

            <div className="grid grid-cols-2 gap-1 rounded-md border border-white/[0.07] bg-black/20 p-2 text-center">
              <div>
                <div className={`text-xs font-semibold ${coverageTone}`}>
                  {vectorFitMetrics
                    ? formatFitPercent(vectorFitMetrics.sourceCoveragePercent)
                    : '—'}
                </div>
                <div className="text-[9px] text-gray-500">Source coverage</div>
              </div>
              <div>
                <div className={`text-xs font-semibold ${outsideTone}`}>
                  {vectorFitMetrics ? formatFitPercent(vectorFitMetrics.outsideSourcePercent) : '—'}
                </div>
                <div className="text-[9px] text-gray-500">Outside source</div>
              </div>
            </div>

            <p className="text-[9px] leading-4 text-gray-500">
              Colored regions become independent B-splines. Bright seams are shared underlap; it is
              clipped to the source shape so the outside edge stays unchanged. The mask only guides
              ownership and joint placement; editable cut curves preserve the local source tangent
              with a small set of smooth controls instead of tracing temporary boundaries.
            </p>

            {error ? (
              <div className="rounded-md border border-red-400/20 bg-red-500/10 p-2 text-[10px] leading-4 text-red-100">
                {error}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => void createParts()}
              disabled={isCreating || isPreviewPending || !preview || preview.parts.length < 2}
              className="w-full rounded-md bg-primary-600 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCreating ? 'Creating editable parts…' : 'Create overlapping parts'}
            </button>
            <p className="text-[9px] leading-4 text-gray-500">
              The original shape is preserved as a hidden source. Track the new group for coarse
              motion, then refine individual parts for fingers, limbs, or other articulation.
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}
