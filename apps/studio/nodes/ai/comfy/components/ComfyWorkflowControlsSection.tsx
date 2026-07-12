import React, { useCallback, useMemo, useState } from 'react';
import { Badge, Popover, ScrollArea } from '@blackboard/ui';
import type { ComfyWorkflow, ComfyWorkflowControl } from '@blackboard/types';
import {
  CollapsibleSection,
  PromptTextField,
  PropertyField,
  ResetIconButton,
  Slider,
  StyledDropdown,
  TextInput,
} from '@blackboard/ui';
import { AttentionPulse, CheckboxIndicator, ToggleSettingRow } from '@/components';
import { getPromptSuggestions } from '@/utils/ai';
import type { ResolvedAiTextRoute } from '@/utils/aiRouting';
import * as Icons from '@blackboard/icons';
import {
  getComfyControlDescription,
  getComfyControlKey,
  isPromptLikeComfyTextInput,
  supportsComfyWorkflowControlRunMode,
  type ComfyWorkflowControlCandidate,
} from '../comfyControls';
import {
  isWorkflowControlSelectedOptionMissing,
  normalizeComparableControlValue,
  type MissingModelSizeStatus,
  type MissingWorkflowControlOption,
} from '../comfyMissingModels';
import {
  coerceControlValue,
  formatControlValue,
  getControlResetTooltip,
} from '../utils/comfyControlValues';
import { MissingModelWarning } from './MissingModelWarning';
import { WorkflowRunModeBadge } from './WorkflowRunModeBadge';
import { WorkflowRunModeControl } from './WorkflowRunModeControl';

type ControlSourceSummary = {
  label: string;
  value?: ComfyWorkflowControl['value'];
};

function RecommendedBindBadge({
  sourceSummary,
  onBind,
}: {
  sourceSummary: ControlSourceSummary;
  onBind: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onBind}
      className="inline-flex h-5 items-center gap-1 rounded border border-primary-300/20 bg-primary-300/10 px-1.5 text-[10px] font-medium text-primary-100 transition hover:border-primary-300/50 hover:bg-primary-300/15 focus-visible:border-primary-300/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-300/30"
      title={`Bind to ${sourceSummary.label}`}
      aria-label={`Bind to ${sourceSummary.label}`}
    >
      <Icons.Link className="h-3.5 w-3.5" />
      Bind
    </button>
  );
}

const formatBoundControlValue = (
  value: ComfyWorkflowControl['value'] | undefined,
  control: ComfyWorkflowControl,
): string => {
  const resolvedValue = value ?? control.value;
  if (typeof resolvedValue === 'number') return formatControlValue(resolvedValue);
  if (typeof resolvedValue === 'boolean') return resolvedValue ? 'On' : 'Off';
  return String(resolvedValue);
};

function BoundWorkflowControl({
  control,
  description,
  sourceSummary,
  onUnbind,
}: {
  control: ComfyWorkflowControl;
  description: React.ReactNode;
  sourceSummary: ControlSourceSummary;
  onUnbind: () => void;
}) {
  const descriptionTitle = typeof description === 'string' ? description : undefined;
  const valueLabel = formatBoundControlValue(sourceSummary.value, control);

  return (
    <div
      className="flex min-w-0 items-center gap-2 rounded-lg border border-primary-300/15 bg-primary-300/[0.045] px-2.5 py-2"
      title={`${control.label}: ${valueLabel} from ${sourceSummary.label}`}
    >
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="max-w-[38%] shrink-0 truncate text-xs font-medium text-gray-300">
          {control.label}
        </span>
        <span
          title={descriptionTitle}
          className="min-w-0 flex-1 truncate text-[11px] leading-4 text-gray-500"
        >
          {description}
        </span>
      </div>

      <div className="inline-flex h-7 max-w-[52%] shrink-0 items-center overflow-hidden rounded-md border border-primary-300/20 bg-primary-300/10 text-[11px] font-medium text-primary-100">
        <span className="inline-flex min-w-0 items-center gap-1.5 px-2">
          <Icons.Link className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate">{sourceSummary.label}</span>
          <span className="font-mono text-gray-100">{valueLabel}</span>
        </span>
        <button
          type="button"
          onClick={onUnbind}
          className="flex h-full w-7 shrink-0 items-center justify-center border-l border-primary-300/20 text-primary-100/70 transition hover:bg-primary-300/15 hover:text-primary-50"
          aria-label={`Unbind ${control.label}`}
          title={`Unbind ${control.label}`}
        >
          <Icons.XMark className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

interface ExpandableWorkflowTextControlProps {
  control: ComfyWorkflowControl;
  description: string;
  promptRoute: ResolvedAiTextRoute | null;
  promptRouteError: string | null;
  onChange: (value: string) => void;
  onEnhance: () => void | Promise<void>;
  onUpdate: (updates: Partial<ComfyWorkflowControl>) => void;
  onReset: () => void;
}

function ExpandableWorkflowTextControl({
  control,
  description,
  promptRoute,
  promptRouteError,
  onChange,
  onEnhance,
  onUpdate,
  onReset,
}: ExpandableWorkflowTextControlProps) {
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const promptValue = String(control.value);
  const isPromptLikeField = isPromptLikeComfyTextInput(control);
  const canUsePromptTools = Boolean(promptRoute);
  const isBusy = isSuggesting || isEnhancing;
  const suggestionPages = control.promptSuggestionPages ?? [];
  const suggestionPageIndex = Math.min(
    Math.max(0, control.promptSuggestionPageIndex ?? 0),
    Math.max(0, suggestionPages.length - 1),
  );
  const currentSuggestions = suggestionPages[suggestionPageIndex] ?? [];
  const areSuggestionsVisible = Boolean(control.promptSuggestionsVisible);
  const promptToolsUnavailableReason = canUsePromptTools
    ? ''
    : (promptRouteError ?? 'Configure prompt tools in Preferences > Integrations.');

  const handleSuggest = async () => {
    if (!promptRoute || isBusy) return;

    setIsSuggesting(true);
    try {
      const suggestionResult = await getPromptSuggestions(promptRoute);
      if (suggestionResult.length > 0) {
        const nextPages = [...suggestionPages, suggestionResult];
        onUpdate({
          promptSuggestionPages: nextPages,
          promptSuggestionPageIndex: nextPages.length - 1,
          promptSuggestionsVisible: true,
        });
      }
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleToggleSuggestions = () => {
    if (areSuggestionsVisible) {
      onUpdate({ promptSuggestionsVisible: false });
      return;
    }

    if (suggestionPages.length === 0) {
      void handleSuggest();
      return;
    }

    onUpdate({ promptSuggestionsVisible: true });
  };

  const handleEnhance = async () => {
    if (!promptRoute || isBusy || promptValue.trim().length === 0) return;

    setIsEnhancing(true);
    try {
      await Promise.resolve(onEnhance());
    } finally {
      setIsEnhancing(false);
    }
  };

  const clearCurrentSuggestionPage = () => {
    const nextPages = suggestionPages.filter((_, index) => index !== suggestionPageIndex);
    onUpdate({
      promptSuggestionPages: nextPages,
      promptSuggestionPageIndex: Math.min(suggestionPageIndex, Math.max(0, nextPages.length - 1)),
      promptSuggestionsVisible: nextPages.length > 0,
    });
  };

  return (
    <PromptTextField
      label={control.label}
      description={description}
      value={promptValue}
      onValueChange={onChange}
      canUsePromptTools={canUsePromptTools}
      promptToolsUnavailableReason={promptToolsUnavailableReason}
      isSuggesting={isSuggesting}
      isEnhancing={isEnhancing}
      suggestions={currentSuggestions}
      suggestionsVisible={areSuggestionsVisible}
      suggestionPageLabel={`${suggestionPageIndex + 1}/${suggestionPages.length}`}
      canPreviousSuggestions={suggestionPageIndex > 0}
      canNextSuggestions={suggestionPageIndex < suggestionPages.length - 1}
      onSuggest={isPromptLikeField ? () => void handleSuggest() : undefined}
      onEnhance={isPromptLikeField ? () => void handleEnhance() : undefined}
      onToggleSuggestions={isPromptLikeField ? handleToggleSuggestions : undefined}
      onPreviousSuggestions={() =>
        onUpdate({
          promptSuggestionPageIndex: Math.max(0, suggestionPageIndex - 1),
          promptSuggestionsVisible: true,
        })
      }
      onNextSuggestions={() =>
        onUpdate({
          promptSuggestionPageIndex: Math.min(suggestionPages.length - 1, suggestionPageIndex + 1),
          promptSuggestionsVisible: true,
        })
      }
      onClearSuggestions={clearCurrentSuggestionPage}
      onSuggestionSelect={onChange}
      onReset={onReset}
      resetTooltip={getControlResetTooltip(control)}
      enhanceLabel="Enhance in Chat"
    />
  );
}

interface ComfyWorkflowControlsSectionProps {
  selectedWorkflow: ComfyWorkflow | null;
  activeControlKeys: ReadonlySet<string>;
  controlCandidates: ComfyWorkflowControlCandidate[];
  activeWorkflowControls: ComfyWorkflowControl[];
  activeMissingControlOptions: MissingWorkflowControlOption[];
  missingModelSizeStatuses: Record<string, MissingModelSizeStatus>;
  missingModelDetailsVisible: boolean;
  runRollTokens: Record<string, number>;
  promptApplyNoticeId: string | null;
  promptApplyNoticeFieldId: string | null;
  imagePromptRoute: ResolvedAiTextRoute | null;
  imagePromptRouteError: string | null;
  controlSourceSummaries: Record<string, ControlSourceSummary>;
  recommendedControlSourceSummaries: Record<string, ControlSourceSummary>;
  onToggleWorkflowField: (candidateKey: string) => void;
  onToggleMissingModelDetails: () => void;
  onDownloadMissingModel: (missingOption: MissingWorkflowControlOption) => void;
  onCopyMissingModelPath: (missingOption: MissingWorkflowControlOption) => void;
  onResetWorkflowControl: (controlId: string) => void;
  onBindControlSource: (controlKey: string) => void;
  onUnbindControlSource: (controlKey: string) => void;
  onUpdateWorkflowControl: (
    controlId: string,
    updates: Partial<ComfyWorkflowControl>,
    withHistory?: boolean,
  ) => void;
  onStartPromptEnhancementChat: (
    controlId: string,
    promptRoute: ResolvedAiTextRoute | null,
  ) => void;
  advancedControlId: string | null;
  onAdvancedControlIdChange: (controlId: string | null) => void;
  onWorkflowPropsKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
}

export function ComfyWorkflowControlsSection({
  selectedWorkflow,
  activeControlKeys,
  controlCandidates,
  activeWorkflowControls,
  activeMissingControlOptions,
  missingModelSizeStatuses,
  missingModelDetailsVisible,
  runRollTokens,
  promptApplyNoticeId,
  promptApplyNoticeFieldId,
  imagePromptRoute,
  imagePromptRouteError,
  controlSourceSummaries,
  recommendedControlSourceSummaries,
  onToggleWorkflowField,
  onToggleMissingModelDetails,
  onDownloadMissingModel,
  onCopyMissingModelPath,
  onResetWorkflowControl,
  onBindControlSource,
  onUnbindControlSource,
  onUpdateWorkflowControl,
  onStartPromptEnhancementChat,
  advancedControlId,
  onAdvancedControlIdChange,
  onWorkflowPropsKeyDown,
}: ComfyWorkflowControlsSectionProps) {
  const [isAddFieldPopoverOpen, setIsAddFieldPopoverOpen] = useState(false);
  const [fieldSearchQuery, setFieldSearchQuery] = useState('');

  // Reset search when popover opens/closes
  const handlePopoverOpenChange = (open: boolean) => {
    if (!open) {
      setFieldSearchQuery('');
    }
    setIsAddFieldPopoverOpen(open);
  };

  // Candidates not currently shown in the props section
  const availableCandidates = useMemo(
    () => controlCandidates.filter((candidate) => !activeControlKeys.has(candidate.key)),
    [controlCandidates, activeControlKeys],
  );

  const normalizedSearchQuery = fieldSearchQuery.trim().toLowerCase();

  // Filter helper: checks if a candidate matches the search query
  const matchesSearch = useCallback(
    (candidate: ComfyWorkflowControlCandidate): boolean => {
      if (!normalizedSearchQuery) return true;
      return (
        candidate.label.toLowerCase().includes(normalizedSearchQuery) ||
        candidate.classType?.toLowerCase().includes(normalizedSearchQuery) ||
        candidate.inputName.toLowerCase().includes(normalizedSearchQuery) ||
        candidate.key.toLowerCase().includes(normalizedSearchQuery) ||
        String(candidate.nodeId).includes(normalizedSearchQuery)
      );
    },
    [normalizedSearchQuery],
  );

  // Filter available candidates by search query
  const filteredAvailableCandidates = useMemo(
    () => availableCandidates.filter(matchesSearch),
    [availableCandidates, matchesSearch],
  );

  // Group filtered candidates for the add-field popover
  const groupedFilteredCandidates = useMemo(
    () =>
      filteredAvailableCandidates.reduce<Record<string, ComfyWorkflowControlCandidate[]>>(
        (groups, candidate) => {
          const group = candidate.classType || 'Other';
          if (!groups[group]) groups[group] = [];
          groups[group].push(candidate);
          return groups;
        },
        {},
      ),
    [filteredAvailableCandidates],
  );

  // Filter active controls by search query for the "Shown fields" section
  const filteredActiveControls = useMemo(
    () =>
      normalizedSearchQuery
        ? activeWorkflowControls.filter((control) => {
            const label = control.label?.toLowerCase() ?? '';
            const classType = control.classType?.toLowerCase() ?? '';
            const inputName = control.inputName?.toLowerCase() ?? '';
            return (
              label.includes(normalizedSearchQuery) ||
              classType.includes(normalizedSearchQuery) ||
              inputName.includes(normalizedSearchQuery)
            );
          })
        : activeWorkflowControls,
    [activeWorkflowControls, normalizedSearchQuery],
  );

  return (
    <CollapsibleSection
      title="Props"
      defaultOpen
      action={
        selectedWorkflow ? (
          <Popover
            isOpen={isAddFieldPopoverOpen}
            onOpenChange={handlePopoverOpenChange}
            align="end"
            sideOffset={4}
            widthClass="w-80"
            trigger={
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-primary-300/20 bg-primary-300/10 px-2 py-1 text-[10px] font-medium text-primary-100 transition hover:border-primary-300/40 hover:bg-primary-300/15"
              >
                <Icons.Plus className="h-3.5 w-3.5" />
                Fields
              </button>
            }
          >
            {(closePopover) => (
              <div
                className="space-y-2"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    closePopover();
                  }
                }}
              >
                {/* Search input */}
                <div className="relative px-1">
                  <Icons.MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
                  <TextInput
                    value={fieldSearchQuery}
                    onValueChange={setFieldSearchQuery}
                    placeholder="Search fields..."
                    autoFocus
                    className="pl-7 pr-3"
                    onPointerDown={(e) => e.stopPropagation()}
                  />
                </div>

                <div className="flex items-center justify-between gap-2 px-1">
                  <span className="text-xs font-medium text-gray-100">
                    {activeControlKeys.size} shown
                  </span>
                  <span className="text-[10px] text-gray-500">
                    {controlCandidates.length} editable
                  </span>
                </div>

                {controlCandidates.length > 0 ? (
                  <ScrollArea
                    axis="y"
                    viewportClassName="max-h-64"
                    contentClassName="space-y-2 pr-1"
                  >
                    {/* Available (unshown) fields */}
                    {Object.entries(groupedFilteredCandidates).length > 0 &&
                    filteredAvailableCandidates.length > 0 ? (
                      Object.entries(groupedFilteredCandidates).map(([classType, candidates]) => (
                        <div key={classType}>
                          <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                            {classType}
                          </div>
                          {candidates.map((candidate) => (
                            <button
                              key={candidate.key}
                              type="button"
                              onClick={() => {
                                onToggleWorkflowField(candidate.key);
                                // Don't close the popover so users can add multiple fields
                              }}
                              className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-gray-400 transition hover:bg-primary-300/10 hover:text-gray-100"
                            >
                              <CheckboxIndicator
                                checked={false}
                                uncheckedIcon={<Icons.Plus className="h-2.5 w-2.5" />}
                              />
                              <span className="min-w-0 flex-1 truncate">{candidate.label}</span>
                              <span className="shrink-0 font-mono text-[10px] text-gray-600">
                                #{candidate.nodeId}
                              </span>
                            </button>
                          ))}
                        </div>
                      ))
                    ) : normalizedSearchQuery ? (
                      <div className="rounded-lg border border-dashed border-gray-700 px-3 py-4 text-center text-[11px] text-gray-500">
                        No fields match "{fieldSearchQuery.trim()}"
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-gray-700 px-3 py-4 text-center text-[11px] text-gray-500">
                        {activeControlKeys.size === controlCandidates.length
                          ? 'All fields are shown'
                          : 'No fields available'}
                      </div>
                    )}

                    {/* Show filtered active fields at the bottom with hide icons */}
                    {filteredActiveControls.length > 0 && (
                      <>
                        <div className="border-t border-white/10 pt-2">
                          <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                            Shown fields
                          </div>
                          {filteredActiveControls.map((control) => {
                            const controlKey = getComfyControlKey(
                              control.nodeId,
                              control.inputName,
                            );
                            return (
                              <button
                                key={controlKey}
                                type="button"
                                onClick={() => {
                                  onToggleWorkflowField(controlKey);
                                }}
                                className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-gray-100 transition hover:bg-red-500/10 hover:text-red-200"
                              >
                                <CheckboxIndicator checked />
                                <span className="min-w-0 flex-1 truncate">{control.label}</span>
                                <Icons.EyeSlash className="h-3 w-3 shrink-0 text-gray-500" />
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </ScrollArea>
                ) : (
                  <div className="rounded-lg border border-dashed border-primary-300/15 bg-gray-950/60 p-3 text-xs leading-5 text-primary-100/60">
                    This workflow does not expose editable primitive fields.
                  </div>
                )}
              </div>
            )}
          </Popover>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {selectedWorkflow ? (
          activeWorkflowControls.length > 0 ? (
            <div className="space-y-3" onKeyDown={onWorkflowPropsKeyDown}>
              {activeMissingControlOptions.length > 0 ? (
                <MissingModelWarning
                  missingOptions={activeMissingControlOptions}
                  modelSizeStatuses={missingModelSizeStatuses}
                  detailsVisible={missingModelDetailsVisible}
                  onToggleDetails={onToggleMissingModelDetails}
                  onDownload={onDownloadMissingModel}
                  onCopyPath={(option) => void onCopyMissingModelPath(option)}
                />
              ) : null}
              {activeWorkflowControls.map((control) => {
                const isNumeric = typeof control.defaultValue === 'number';
                const numericValue =
                  typeof control.value === 'number'
                    ? control.value
                    : (control.defaultValue as number);
                const booleanValue =
                  typeof control.value === 'boolean'
                    ? control.value
                    : Boolean(control.defaultValue);
                const description = control.description ?? getComfyControlDescription(control);
                const supportsRunMode = supportsComfyWorkflowControlRunMode(control);
                const enumValue =
                  typeof control.value === 'string' || typeof control.value === 'number'
                    ? control.value
                    : String(control.value);
                const isSelectedEnumOptionMissing = isWorkflowControlSelectedOptionMissing(control);
                const enumOptions =
                  control.options && control.options.length > 0
                    ? isSelectedEnumOptionMissing
                      ? [enumValue, ...control.options]
                      : control.options
                    : [];
                const hasEnumOptions = enumOptions.length > 0;
                const applyNoticeKey =
                  promptApplyNoticeFieldId === control.id ? promptApplyNoticeId : null;
                const controlKey = getComfyControlKey(control.nodeId, control.inputName);
                const sourceSummary = controlSourceSummaries[controlKey];
                const recommendedSourceSummary = recommendedControlSourceSummaries[controlKey];
                const recommendedBindBadge = recommendedSourceSummary ? (
                  <RecommendedBindBadge
                    sourceSummary={recommendedSourceSummary}
                    onBind={() => onBindControlSource(controlKey)}
                  />
                ) : null;

                return (
                  <AttentionPulse
                    key={control.id}
                    activeKey={applyNoticeKey}
                    data-ai-apply-control-id={control.id}
                    className="rounded-lg"
                  >
                    {sourceSummary ? (
                      <BoundWorkflowControl
                        control={control}
                        description={description}
                        sourceSummary={sourceSummary}
                        onUnbind={() => onUnbindControlSource(controlKey)}
                      />
                    ) : (
                      <PropertyField
                        label={hasEnumOptions ? control.label : undefined}
                        description={hasEnumOptions ? description : undefined}
                        actions={
                          hasEnumOptions || (!isNumeric && recommendedBindBadge) ? (
                            <>
                              {!isNumeric ? recommendedBindBadge : null}
                              {isSelectedEnumOptionMissing ? (
                                <Badge
                                  size="sm"
                                  variant="danger"
                                  className="!bg-black/20 !text-red-100/70 font-mono"
                                  title="Selected option is missing"
                                >
                                  Missing
                                </Badge>
                              ) : null}
                              <ResetIconButton
                                onClick={() => onResetWorkflowControl(control.id)}
                                tooltip={getControlResetTooltip(control)}
                              />
                            </>
                          ) : undefined
                        }
                      >
                        {hasEnumOptions ? (
                          <StyledDropdown
                            value={enumValue}
                            options={enumOptions.map((option) => {
                              const isMissingOption =
                                isSelectedEnumOptionMissing &&
                                normalizeComparableControlValue(option) ===
                                  normalizeComparableControlValue(enumValue);

                              return {
                                value: option,
                                label: String(option),
                                badges: isMissingOption ? ['Missing'] : undefined,
                                searchText: isMissingOption
                                  ? `${String(option)} missing`
                                  : undefined,
                              };
                            })}
                            onChange={(value) =>
                              onUpdateWorkflowControl(control.id, {
                                value:
                                  typeof value === 'string' || typeof value === 'number'
                                    ? value
                                    : String(value),
                              })
                            }
                            popoverWidthClass="w-72"
                            showSelectedBadges={false}
                          />
                        ) : isNumeric ? (
                          <Slider
                            label={control.label}
                            description={description}
                            value={numericValue}
                            min={control.min}
                            max={control.max}
                            step={control.step}
                            onChange={(value) =>
                              onUpdateWorkflowControl(control.id, { value }, true)
                            }
                            onReset={() => onResetWorkflowControl(control.id)}
                            resetTooltip={getControlResetTooltip(control)}
                            displayFormatter={formatControlValue}
                            valuePrefix={
                              supportsRunMode || recommendedBindBadge ? (
                                <span className="inline-flex items-center gap-1">
                                  {recommendedBindBadge}
                                  {supportsRunMode ? (
                                    <WorkflowRunModeBadge
                                      control={control}
                                      rollToken={runRollTokens[control.id] ?? 0}
                                      onUpdate={(updates) =>
                                        onUpdateWorkflowControl(control.id, updates, true)
                                      }
                                    />
                                  ) : null}
                                </span>
                              ) : undefined
                            }
                            headerActions={
                              supportsRunMode ? (
                                <WorkflowRunModeControl
                                  control={control}
                                  isOpen={advancedControlId === control.id}
                                  onOpenChange={(open) =>
                                    onAdvancedControlIdChange(open ? control.id : null)
                                  }
                                  onKeyDown={onWorkflowPropsKeyDown}
                                  onUpdate={(updates) =>
                                    onUpdateWorkflowControl(control.id, updates, true)
                                  }
                                />
                              ) : undefined
                            }
                          />
                        ) : typeof control.defaultValue === 'boolean' ? (
                          <ToggleSettingRow
                            label={control.label}
                            description={description}
                            checked={booleanValue}
                            onCheckedChange={(checked) =>
                              onUpdateWorkflowControl(control.id, {
                                value: checked,
                              })
                            }
                            title={booleanValue ? 'Enabled' : 'Disabled'}
                            labelAccessory={
                              <span className="flex shrink-0 items-center gap-1">
                                {recommendedBindBadge}
                                <ResetIconButton
                                  onClick={() => onResetWorkflowControl(control.id)}
                                  tooltip={getControlResetTooltip(control)}
                                />
                              </span>
                            }
                          />
                        ) : (
                          <ExpandableWorkflowTextControl
                            control={control}
                            description={description}
                            promptRoute={imagePromptRoute}
                            promptRouteError={imagePromptRouteError}
                            onChange={(value) =>
                              onUpdateWorkflowControl(control.id, {
                                value: coerceControlValue(value, control.defaultValue),
                              })
                            }
                            onEnhance={() =>
                              onStartPromptEnhancementChat(control.id, imagePromptRoute)
                            }
                            onUpdate={(updates) => onUpdateWorkflowControl(control.id, updates)}
                            onReset={() => onResetWorkflowControl(control.id)}
                          />
                        )}
                      </PropertyField>
                    )}
                  </AttentionPulse>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-700 bg-gray-900/70 p-3 text-xs leading-5 text-gray-400">
              No workflow props are shown yet. Use the Fields button to add workflow inputs here.
            </div>
          )
        ) : (
          <div className="rounded-lg border border-dashed border-gray-700 bg-gray-900/70 p-3 text-xs leading-5 text-gray-400">
            Load a workflow before choosing Comfy props.
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
