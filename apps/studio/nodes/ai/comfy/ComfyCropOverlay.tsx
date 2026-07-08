import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  EditorTab,
  type ComfyNode,
  type ComfyWorkflow,
  type GeneratedOutput,
  type ViewportPromptRegion,
} from '@blackboard/types';
import { PromptTextField } from '@blackboard/ui';
import { ecc } from '@/features/viewport/overlays';
import type { ViewportOverlayProps } from '@/nodes/NodeDefinition';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { usePreferences } from '@/state/preferencesContext';
import { enhancePrompt, getPromptSuggestions } from '@/utils/ai';
import { getAiTaskRouteError, resolveAiTaskRoute } from '@/utils/aiRouting';
import { requestRegisteredNodeExecution } from '@/utils/nodeExecutionRegistry';
import {
  getComfyGeneratedOutputsForGalleryActivation,
  getComfyOutputActivationRegionId,
} from './comfyOutputActivation';
import { getComfyGeneratedOutputsForGalleryScope } from './comfyOutputLayers';
import { getComfyOutputTransform } from './comfyOutputTransform';
import { getActiveComfyOutputJobs, getPendingComfyOutputSlots } from './comfyOutputGallery';
import { isComfyRunShortcut } from './comfyRunShortcut';
import {
  COMFY_CROP_VIEWPORT_TOOL,
  getExplicitSelectedComfyViewportPromptRegion,
  getComfyViewportPromptRegionLabel,
  mergeComfyViewportBindings,
} from './comfyViewportBindings';
import { ComfyOutputGalleryStrip } from './components/ComfyOutputGalleryStrip';
import { ComfyRunButtonGroup } from './components/ComfyRunButtonGroup';

const HANDLE_SIZE = 7;
const PROMPT_PANEL_MARGIN = 12;
const PROMPT_PANEL_MIN_WIDTH = 260;
const PROMPT_PANEL_MAX_WIDTH = 380;
const PROMPT_PANEL_ESTIMATED_HEIGHT = 132;
const PROMPT_PANEL_WITH_GALLERY_ESTIMATED_HEIGHT = 230;

const getSelectedWorkflowOutputIds = (workflow: ComfyWorkflow): string[] => {
  const candidateIds = new Set((workflow.outputCandidates ?? []).map((candidate) => candidate.id));
  if (workflow.selectedOutputIds) {
    return workflow.selectedOutputIds.filter((id) => candidateIds.has(id));
  }
  const firstCandidate = workflow.outputCandidates?.[0];
  return firstCandidate ? [firstCandidate.id] : [];
};

const updateRegionInNode = (
  node: ComfyNode,
  region: ViewportPromptRegion,
): ViewportPromptRegion[] =>
  (node.viewportPromptRegions ?? []).map((candidate) =>
    candidate.id === region.id ? region : candidate,
  );

export function ComfyCropSvgOverlay(props: ViewportOverlayProps) {
  const node = props.node as ComfyNode;
  const sceneSize = { width: props.scene.width, height: props.scene.height };
  const zoom = props.zoom;
  const selectedRegionId = node.selectedViewportPromptRegionId;
  const regions = node.viewportPromptRegions ?? [];
  const visibleRegions = regions.filter((region) => region.visible !== false);

  const ctx = ecc(props);
  const mouseScenePos = ctx.viewport.mouseScenePos;
  const activeViewportTool = ctx.viewport.activeViewportTool;
  const isRegionToolActive =
    activeViewportTool === COMFY_CROP_VIEWPORT_TOOL || activeViewportTool === 'select';

  // Compute which region the mouse is hovering over using the same
  // hit-testing approach as the interaction hook.
  // mouseScenePos is in centered coords (origin at scene center), but
  // region rects are in top-left scene coords (matching the SVG viewBox).
  // Convert by adding half the scene dimensions, same as toScenePixel().
  const hoverHalfSize = useMemo(
    () => ({ hw: sceneSize.width / 2, hh: sceneSize.height / 2 }),
    [sceneSize.width, sceneSize.height],
  );
  // Build a top-left hover point from the centered mouseScenePos.
  const hoverPoint = useMemo<{ x: number; y: number } | null>(
    () =>
      mouseScenePos
        ? { x: mouseScenePos.x + hoverHalfSize.hw, y: mouseScenePos.y + hoverHalfSize.hh }
        : null,
    [mouseScenePos, hoverHalfSize],
  );

  const hoveredRegionId = useMemo<string | null>(() => {
    if (!hoverPoint || !isRegionToolActive) return null;
    const tolerance = 10 / Math.max(zoom, 0.1);
    for (let i = visibleRegions.length - 1; i >= 0; i--) {
      const r = visibleRegions[i];
      const { x, y, width, height } = r.rect;
      const inside =
        hoverPoint.x >= x - tolerance &&
        hoverPoint.x <= x + width + tolerance &&
        hoverPoint.y >= y - tolerance &&
        hoverPoint.y <= y + height + tolerance;
      if (inside) return r.id;
    }
    return null;
  }, [hoverPoint, visibleRegions, isRegionToolActive, zoom]);

  // Compute which corner handle (0–3 on the selected region) the mouse is
  // hovering near, using the same hit-tolerance as the interaction hook.
  const hoveredHandleIndex = useMemo<number | null>(() => {
    if (!hoverPoint || !selectedRegionId || !isRegionToolActive) return null;
    const selRegion = visibleRegions.find((r) => r.id === selectedRegionId);
    if (!selRegion) return null;
    const { x, y, width, height } = selRegion.rect;
    const corners = [
      [x, y],
      [x + width, y],
      [x, y + height],
      [x + width, y + height],
    ];
    const tolerance = 10 / Math.max(zoom, 0.1);
    for (let i = 0; i < corners.length; i++) {
      const [cx, cy] = corners[i];
      if (Math.abs(hoverPoint.x - cx) <= tolerance && Math.abs(hoverPoint.y - cy) <= tolerance) {
        return i;
      }
    }
    return null;
  }, [hoverPoint, selectedRegionId, visibleRegions, isRegionToolActive, zoom]);

  return (
    <>
      {visibleRegions.map((region) => {
        const isSelected = region.id === selectedRegionId;
        const isHovered = region.id === hoveredRegionId && !isSelected;
        const rect = region.rect;
        const label = getComfyViewportPromptRegionLabel(regions, region.id);
        const handleSize = HANDLE_SIZE / zoom;
        const handles = [
          [rect.x, rect.y],
          [rect.x + rect.width, rect.y],
          [rect.x, rect.y + rect.height],
          [rect.x + rect.width, rect.y + rect.height],
        ];
        // Allow handles outside scene bounds (outpainting support)
        const unclampedHandleX = (x: number) => x - handleSize / 2;
        const unclampedHandleY = (y: number) => y - handleSize / 2;
        const clampHandleX = unclampedHandleX;
        const clampHandleY = unclampedHandleY;

        return (
          <g key={region.id} pointerEvents="none">
            {/* Hover fill highlight */}
            {isHovered && (
              <rect
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                fill="rgba(125, 211, 252, 0.08)"
                rx={1}
              />
            )}
            <rect
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              fill="none"
              stroke={
                isSelected
                  ? 'rgba(125, 211, 252, 0.95)'
                  : isHovered
                    ? 'rgba(125, 211, 252, 0.7)'
                    : 'rgba(203, 213, 225, 0.55)'
              }
              strokeWidth={Math.max(1, 2 / zoom)}
              strokeDasharray={`${6 / zoom} ${4 / zoom}`}
            />
            {isSelected && (
              <text
                x={rect.x + 8 / zoom}
                y={rect.y + 18 / zoom}
                fill="rgba(240, 249, 255, 0.95)"
                stroke="rgba(8, 47, 73, 0.9)"
                strokeWidth={2.5 / zoom}
                paintOrder="stroke"
                fontSize={11 / zoom}
                fontWeight={600}
              >
                {`${label}  ${Math.round(rect.width)} x ${Math.round(rect.height)}`}
              </text>
            )}
            {isSelected &&
              handles.map(([x, y], index) => {
                const isHandleHovered = index === hoveredHandleIndex;
                const hiSize = isHandleHovered ? handleSize * 1.6 : handleSize;
                const hiCenterX = x;
                const hiCenterY = y;
                return (
                  <g key={`${x}:${y}`}>
                    {/* Glow ring behind hovered handle */}
                    {isHandleHovered && (
                      <rect
                        x={clampHandleX(hiCenterX - handleSize * 0.3)}
                        y={clampHandleY(hiCenterY - handleSize * 0.3)}
                        width={handleSize * 1.6}
                        height={handleSize * 1.6}
                        fill="rgba(125, 211, 252, 0.25)"
                        rx={2 / zoom}
                      />
                    )}
                    <rect
                      x={clampHandleX(hiCenterX - (hiSize - handleSize) / 2)}
                      y={clampHandleY(hiCenterY - (hiSize - handleSize) / 2)}
                      width={hiSize}
                      height={hiSize}
                      fill={isHandleHovered ? 'rgba(255, 255, 255, 0.95)' : 'rgb(125, 211, 252)'}
                      stroke={isHandleHovered ? 'rgb(125, 211, 252)' : 'rgb(15, 23, 42)'}
                      strokeWidth={1.5 / zoom}
                      rx={1.5 / zoom}
                    />
                  </g>
                );
              })}
          </g>
        );
      })}
    </>
  );
}

export function ComfyCropPromptOverlay(props: ViewportOverlayProps) {
  const ctx = ecc(props);
  const viewport = ctx.viewport;
  const node = props.node as ComfyNode;
  const cropInteraction = ctx.comfyCrop;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const focusedDrawRef = useRef<string | null>(null);
  const viewportSize = viewport.viewportSize;
  const sceneSize = { width: props.scene.width, height: props.scene.height };
  const zoom = props.zoom;
  const pan = props.pan;
  const { updateNode, setActiveTab, setSubPanelVisible, requestBackgroundJobCancel } =
    useEditorActions();
  const backgroundJobs = useEditorSelector((state) => state.backgroundJobs);
  const projectId = useEditorSelector((state) => state.projectId);
  const activeProjectBranchId = useEditorSelector((state) => state.activeProjectBranchId);
  const { aiTaskRoutes, integrationConnections } = usePreferences();
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const region = getExplicitSelectedComfyViewportPromptRegion(node);
  const workflow =
    node.workflows.find((candidate) => candidate.id === node.selectedWorkflowId) ??
    node.workflows[0] ??
    null;
  const promptRouteError = getAiTaskRouteError('imagePromptTools', {
    aiTaskRoutes,
    integrationConnections,
  });
  const promptRoute = promptRouteError
    ? null
    : resolveAiTaskRoute('imagePromptTools', {
        aiTaskRoutes,
        integrationConnections,
      });

  const suggestions = useMemo(() => {
    const pages = region?.promptSuggestionPages ?? [];
    const index = Math.min(Math.max(0, region?.promptSuggestionPageIndex ?? 0), pages.length - 1);
    return pages[index] ?? [];
  }, [region?.promptSuggestionPageIndex, region?.promptSuggestionPages]);
  const regionOutputs = useMemo(
    () => (region ? [...getComfyGeneratedOutputsForGalleryScope(node, region.id)].reverse() : []),
    [node, region],
  );
  const activeNodeComfyJobs = useMemo(
    () =>
      getActiveComfyOutputJobs({
        jobs: backgroundJobs,
        nodeId: node.id,
        projectId,
        branchId: activeProjectBranchId,
      }),
    [activeProjectBranchId, backgroundJobs, node.id, projectId],
  );
  const pendingOutputSlots = useMemo(
    () => getPendingComfyOutputSlots(activeNodeComfyJobs, region?.id),
    [activeNodeComfyJobs, region?.id],
  );

  // Auto-focus the prompt textarea when a new region is freshly created via draw.
  // Uses focusedDrawRef to only focus once per draw cycle (the justCreatedRegionId
  // stays set until the user interacts with a different region, so we avoid
  // re-focusing on every unrelated re-render).
  useEffect(() => {
    if (
      region &&
      cropInteraction.justCreatedRegionId &&
      cropInteraction.justCreatedRegionId === region.id &&
      focusedDrawRef.current !== cropInteraction.justCreatedRegionId &&
      textareaRef.current
    ) {
      textareaRef.current.focus();
      focusedDrawRef.current = cropInteraction.justCreatedRegionId;
    }
  }, [region, cropInteraction.justCreatedRegionId]);

  if (
    cropInteraction.dragState ||
    !region ||
    region.visible === false ||
    viewportSize.width <= 0 ||
    viewportSize.height <= 0
  ) {
    return null;
  }

  const regionLabel = getComfyViewportPromptRegionLabel(node.viewportPromptRegions, region.id);
  const hasNoSelectedWorkflowOutputs =
    workflow !== null &&
    (workflow.outputCandidates ?? []).length > 0 &&
    getSelectedWorkflowOutputIds(workflow).length === 0;
  const isRunDisabled = !workflow || hasNoSelectedWorkflowOutputs;
  const showRegionGallery = regionOutputs.length > 0 || pendingOutputSlots.length > 0;
  const promptPanelEstimatedHeight = showRegionGallery
    ? PROMPT_PANEL_WITH_GALLERY_ESTIMATED_HEIGHT
    : PROMPT_PANEL_ESTIMATED_HEIGHT;

  const writeRegion = (nextRegion: ViewportPromptRegion, withHistory = false) => {
    updateNode(
      node.id,
      {
        viewportPromptRegions: updateRegionInNode(node, {
          ...nextRegion,
          bindings: mergeComfyViewportBindings(workflow, nextRegion.bindings),
        }),
        selectedViewportPromptRegionId: nextRegion.id,
      },
      withHistory,
    );
  };

  const handleSuggest = async () => {
    if (!promptRoute || isSuggesting || isEnhancing) return;
    setIsSuggesting(true);
    setError(null);
    try {
      const nextSuggestions = await getPromptSuggestions(promptRoute);
      if (nextSuggestions.length > 0) {
        writeRegion(
          {
            ...region,
            promptSuggestionPages: [...(region.promptSuggestionPages ?? []), nextSuggestions],
            promptSuggestionPageIndex: region.promptSuggestionPages?.length ?? 0,
            promptSuggestionsVisible: true,
          },
          true,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to suggest prompts.');
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleEnhance = async () => {
    if (!promptRoute || isSuggesting || isEnhancing || region.prompt.trim().length === 0) return;
    setIsEnhancing(true);
    setError(null);
    try {
      const enhanced = await enhancePrompt(region.prompt, promptRoute);
      writeRegion({ ...region, prompt: enhanced }, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enhance prompt.');
    } finally {
      setIsEnhancing(false);
    }
  };

  const requestRun = (runCount = 1) => {
    requestRegisteredNodeExecution(node.id, {
      source: 'viewportTool',
      runCount,
      regionId: region.id,
    });
  };

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isComfyRunShortcut(event)) return;

    const field = (event.target as HTMLElement | null)?.closest('textarea');
    if (!(field instanceof HTMLElement)) return;

    event.preventDefault();
    event.stopPropagation();
    if (document.activeElement === field) field.blur();

    window.setTimeout(() => requestRun(1), 0);
  };

  const handleActivateOutput = (output: GeneratedOutput) => {
    updateNode(
      node.id,
      {
        src: output.src,
        mediaKind: output.mediaKind ?? 'image',
        colorSpace: output.colorSpace ?? node.colorSpace,
        frames: output.frames,
        duration: output.duration,
        fps: output.fps,
        width: output.width,
        height: output.height,
        transform: getComfyOutputTransform({ node, output, sceneNode: props.scene }),
        generatedOutputs: getComfyGeneratedOutputsForGalleryActivation(node, output),
        activeGeneratedOutputId: output.id,
        selectedViewportPromptRegionId: getComfyOutputActivationRegionId(node, output),
        lastPromptId: output.promptId,
        lastRunAt: output.createdAt,
      },
      true,
    );
  };

  const openGallery = () => {
    setSubPanelVisible(true);
    setActiveTab(EditorTab.Gallery);
  };

  const regionScreenRect = {
    left: viewportSize.width / 2 + pan.x + (region.rect.x - sceneSize.width / 2) * zoom,
    right:
      viewportSize.width / 2 +
      pan.x +
      (region.rect.x + region.rect.width - sceneSize.width / 2) * zoom,
    top: viewportSize.height / 2 - pan.y + (region.rect.y - sceneSize.height / 2) * zoom,
    bottom:
      viewportSize.height / 2 -
      pan.y +
      (region.rect.y + region.rect.height - sceneSize.height / 2) * zoom,
  };
  const availableWidth = Math.max(160, viewportSize.width - PROMPT_PANEL_MARGIN * 2);
  const panelWidth = Math.min(
    PROMPT_PANEL_MAX_WIDTH,
    availableWidth,
    Math.max(PROMPT_PANEL_MIN_WIDTH, regionScreenRect.right - regionScreenRect.left),
  );
  const unclampedLeft = Math.min(regionScreenRect.left, regionScreenRect.right - panelWidth);
  const left = Math.max(
    PROMPT_PANEL_MARGIN,
    Math.min(unclampedLeft, viewportSize.width - panelWidth - PROMPT_PANEL_MARGIN),
  );
  const belowTop = regionScreenRect.bottom + 10;
  const aboveTop = regionScreenRect.top - promptPanelEstimatedHeight - 10;
  const top =
    belowTop + promptPanelEstimatedHeight <= viewportSize.height - PROMPT_PANEL_MARGIN
      ? belowTop
      : aboveTop >= PROMPT_PANEL_MARGIN
        ? aboveTop
        : Math.max(
            PROMPT_PANEL_MARGIN,
            Math.min(
              belowTop,
              viewportSize.height - promptPanelEstimatedHeight - PROMPT_PANEL_MARGIN,
            ),
          );
  const canUsePromptTools = Boolean(promptRoute);

  return (
    <div
      className="absolute z-30 pointer-events-auto"
      style={{
        left,
        top,
        width: panelWidth,
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseMove={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
      onKeyDown={handlePromptKeyDown}
    >
      <div className="rounded-lg border border-white/15 bg-gray-950/70 p-2 shadow-2xl shadow-black/45 backdrop-blur-xl ring-1 ring-white/10">
        <PromptTextField
          inputRef={textareaRef}
          label={`${regionLabel} Prompt`}
          value={region.prompt}
          onValueChange={(v) => writeRegion({ ...region, prompt: v }, false)}
          placeholder="replace this area with rainy neon street"
          canUsePromptTools={canUsePromptTools}
          promptToolsUnavailableReason={promptRouteError ?? undefined}
          isSuggesting={isSuggesting}
          isEnhancing={isEnhancing}
          suggestions={suggestions}
          suggestionsVisible={region.promptSuggestionsVisible ?? false}
          suggestionPageLabel={
            (region.promptSuggestionPages?.length ?? 0) > 0
              ? `${(region.promptSuggestionPageIndex ?? 0) + 1}/${region.promptSuggestionPages!.length}`
              : undefined
          }
          canPreviousSuggestions={(region.promptSuggestionPageIndex ?? 0) > 0}
          canNextSuggestions={
            (region.promptSuggestionPageIndex ?? 0) <
            (region.promptSuggestionPages?.length ?? 0) - 1
          }
          onSuggest={() => void handleSuggest()}
          onEnhance={() => void handleEnhance()}
          onToggleSuggestions={() =>
            writeRegion(
              { ...region, promptSuggestionsVisible: !region.promptSuggestionsVisible },
              false,
            )
          }
          onPreviousSuggestions={() =>
            writeRegion(
              {
                ...region,
                promptSuggestionPageIndex: Math.max(0, (region.promptSuggestionPageIndex ?? 0) - 1),
                promptSuggestionsVisible: true,
              },
              false,
            )
          }
          onNextSuggestions={() =>
            writeRegion(
              {
                ...region,
                promptSuggestionPageIndex: Math.min(
                  (region.promptSuggestionPages?.length ?? 1) - 1,
                  (region.promptSuggestionPageIndex ?? 0) + 1,
                ),
                promptSuggestionsVisible: true,
              },
              false,
            )
          }
          onClearSuggestions={() => {
            const pages = region.promptSuggestionPages ?? [];
            const currentIndex = region.promptSuggestionPageIndex ?? 0;
            const nextPages = pages.filter((_, i) => i !== currentIndex);
            writeRegion(
              {
                ...region,
                promptSuggestionPages: nextPages,
                promptSuggestionPageIndex: Math.min(
                  currentIndex,
                  Math.max(0, nextPages.length - 1),
                ),
                promptSuggestionsVisible: nextPages.length > 0,
              },
              false,
            );
          }}
          onSuggestionSelect={(v) => writeRegion({ ...region, prompt: v }, true)}
          onReset={() => writeRegion({ ...region, prompt: '' }, false)}
          resetTooltip="Reset prompt"
        />
        {error ? <p className="mt-1 text-[10px] text-red-300">{error}</p> : null}
        {showRegionGallery ? (
          <div className="mt-2 rounded-md border border-white/10 bg-gray-950/35 p-2">
            <ComfyOutputGalleryStrip
              label={`${regionLabel} outputs`}
              outputs={regionOutputs}
              pendingSlots={pendingOutputSlots}
              activeOutputId={node.activeGeneratedOutputId}
              fallbackActiveSrc={node.src}
              onActivateOutput={handleActivateOutput}
              onOpenGallery={openGallery}
              onCancelPending={requestBackgroundJobCancel}
            />
          </div>
        ) : null}
        <div className="mt-2 flex items-center gap-1">
          <ComfyRunButtonGroup
            disabled={isRunDisabled}
            runShortcutHint="viewport tool"
            onRun={() => requestRun(1)}
            onBatchRun={requestRun}
            className="ml-auto"
          />
        </div>
      </div>
    </div>
  );
}
