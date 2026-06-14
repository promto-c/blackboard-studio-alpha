import { useMemo, useState } from 'react';
import type { ComfyNode, ComfyWorkflow, ViewportPromptRegion } from '@blackboard/types';
import { useEditorActions } from '@/state/editorContext';
import { usePreferences } from '@/state/preferencesContext';
import { enhancePrompt, getPromptSuggestions } from '@/utils/ai';
import { getAiTaskRouteError, resolveAiTaskRoute } from '@/utils/aiRouting';
import { requestRegisteredNodeExecution } from '@/utils/nodeExecutionRegistry';
import {
  getExplicitSelectedComfyViewportPromptRegion,
  getComfyViewportPromptRegionLabel,
  mergeComfyViewportBindings,
} from './comfyViewportBindings';
import { ComfyRunButtonGroup } from './components/ComfyRunButtonGroup';
import { PromptTextField } from '@blackboard/ui';
import { ecc } from '@/features/viewport/overlays';
import type { ViewportOverlayProps } from '@/nodes/NodeDefinition';

const HANDLE_SIZE = 7;
const PROMPT_PANEL_MARGIN = 12;
const PROMPT_PANEL_MIN_WIDTH = 260;
const PROMPT_PANEL_MAX_WIDTH = 380;
const PROMPT_PANEL_ESTIMATED_HEIGHT = 132;

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

  return (
    <>
      {visibleRegions.map((region) => {
        const isSelected = region.id === selectedRegionId;
        const rect = region.rect;
        const label = getComfyViewportPromptRegionLabel(regions, region.id);
        const handleSize = HANDLE_SIZE / zoom;
        const handles = [
          [rect.x, rect.y],
          [rect.x + rect.width, rect.y],
          [rect.x, rect.y + rect.height],
          [rect.x + rect.width, rect.y + rect.height],
        ];
        const clampHandleX = (x: number) =>
          Math.max(0, Math.min(x - handleSize / 2, sceneSize.width - handleSize));
        const clampHandleY = (y: number) =>
          Math.max(0, Math.min(y - handleSize / 2, sceneSize.height - handleSize));

        return (
          <g key={region.id} pointerEvents="none">
            <rect
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              fill={isSelected ? 'rgba(45, 212, 191, 0.08)' : 'rgba(148, 163, 184, 0.06)'}
              stroke={isSelected ? 'rgba(94, 234, 212, 0.95)' : 'rgba(203, 213, 225, 0.65)'}
              strokeWidth={Math.max(1, 2 / zoom)}
              strokeDasharray={`${6 / zoom} ${4 / zoom}`}
            />
            <text
              x={rect.x + 8 / zoom}
              y={rect.y + 18 / zoom}
              fill="rgba(240, 253, 250, 0.9)"
              fontSize={11 / zoom}
              fontWeight={600}
            >
              {label}
            </text>
            {isSelected && (
              <text
                x={rect.x + rect.width / 2}
                y={rect.y + rect.height / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="rgba(240, 253, 250, 0.85)"
                fontSize={12 / zoom}
                fontWeight={600}
              >
                Selected Region
              </text>
            )}
            {isSelected &&
              handles.map(([x, y]) => (
                <rect
                  key={`${x}:${y}`}
                  x={clampHandleX(x)}
                  y={clampHandleY(y)}
                  width={handleSize}
                  height={handleSize}
                  fill="rgb(94, 234, 212)"
                  stroke="rgb(15, 23, 42)"
                  strokeWidth={1 / zoom}
                />
              ))}
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
  const cropInteraction = ctx.comfyCrop as { dragState?: unknown };
  const viewportSize = viewport.viewportSize;
  const sceneSize = { width: props.scene.width, height: props.scene.height };
  const zoom = props.zoom;
  const pan = props.pan;
  const { updateNode } = useEditorActions();
  const {
    geminiApiKey,
    openAiApiKey,
    openAiBaseUrl,
    ollamaEndpoint,
    aiTaskRoutes,
    integrationConnections,
  } = usePreferences();
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
    geminiApiKey,
    openAiApiKey,
    openAiBaseUrl,
    ollamaEndpoint,
  });
  const promptRoute = promptRouteError
    ? null
    : resolveAiTaskRoute('imagePromptTools', {
        aiTaskRoutes,
        integrationConnections,
        geminiApiKey,
        openAiApiKey,
        openAiBaseUrl,
        ollamaEndpoint,
      });

  const suggestions = useMemo(() => {
    const pages = region?.promptSuggestionPages ?? [];
    const index = Math.min(Math.max(0, region?.promptSuggestionPageIndex ?? 0), pages.length - 1);
    return pages[index] ?? [];
  }, [region?.promptSuggestionPageIndex, region?.promptSuggestionPages]);

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
    requestRegisteredNodeExecution(node.id, { source: 'viewportTool', runCount });
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
  const aboveTop = regionScreenRect.top - PROMPT_PANEL_ESTIMATED_HEIGHT - 10;
  const top =
    belowTop + PROMPT_PANEL_ESTIMATED_HEIGHT <= viewportSize.height - PROMPT_PANEL_MARGIN
      ? belowTop
      : aboveTop >= PROMPT_PANEL_MARGIN
        ? aboveTop
        : Math.max(
            PROMPT_PANEL_MARGIN,
            Math.min(
              belowTop,
              viewportSize.height - PROMPT_PANEL_ESTIMATED_HEIGHT - PROMPT_PANEL_MARGIN,
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
    >
      <div className="rounded-lg border border-white/15 bg-gray-950/70 p-2 shadow-2xl shadow-black/45 backdrop-blur-xl ring-1 ring-white/10">
        <PromptTextField
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
