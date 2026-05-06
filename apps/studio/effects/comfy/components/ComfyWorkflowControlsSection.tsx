import React, { useState } from 'react';
import { ScrollArea } from '@blackboard/ui';
import type { ComfyWorkflow, ComfyWorkflowControl } from '@blackboard/types';
import {
  AttentionPulse,
  CollapsibleSection,
  PromptTextField,
  PropertyField,
  ResetIconButton,
  Slider,
  StyledDropdown,
  ToggleSwitch,
} from '@/components';
import { getPromptSuggestions } from '@/utils/ai';
import type { ResolvedAiTextRoute } from '@/utils/aiRouting';
import * as Icons from '@blackboard/icons';
import {
  getComfyControlDescription,
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

interface ExpandableWorkflowTextControlProps {
  control: ComfyWorkflowControl;
  description: string;
  promptRoute: ResolvedAiTextRoute | null;
  promptRouteError: string | null;
  onChange: (value: string) => void;
  onEnhance: () => Promise<void>;
  onUpdate: (updates: Partial<ComfyWorkflowControl>) => void;
  onReset: () => void;
}

const ExpandableWorkflowTextControl: React.FC<ExpandableWorkflowTextControlProps> = ({
  control,
  description,
  promptRoute,
  promptRouteError,
  onChange,
  onEnhance,
  onUpdate,
  onReset,
}) => {
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
      await onEnhance();
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
};

interface ComfyWorkflowControlsSectionProps {
  selectedWorkflow: ComfyWorkflow | null;
  isWorkflowControlBuilderOpen: boolean;
  pendingControlKeys: ReadonlySet<string>;
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
  onOpenWorkflowControlBuilder: () => void;
  onCancelWorkflowControlBuilder: () => void;
  onApplyWorkflowControlBuilder: () => void;
  onToggleWorkflowControlCandidate: (candidateKey: string) => void;
  onToggleMissingModelDetails: () => void;
  onDownloadMissingModel: (missingOption: MissingWorkflowControlOption) => void;
  onCopyMissingModelPath: (missingOption: MissingWorkflowControlOption) => void;
  onResetWorkflowControl: (controlId: string) => void;
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

export const ComfyWorkflowControlsSection: React.FC<ComfyWorkflowControlsSectionProps> = ({
  selectedWorkflow,
  isWorkflowControlBuilderOpen,
  pendingControlKeys,
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
  onOpenWorkflowControlBuilder,
  onCancelWorkflowControlBuilder,
  onApplyWorkflowControlBuilder,
  onToggleWorkflowControlCandidate,
  onToggleMissingModelDetails,
  onDownloadMissingModel,
  onCopyMissingModelPath,
  onResetWorkflowControl,
  onUpdateWorkflowControl,
  onStartPromptEnhancementChat,
  advancedControlId,
  onAdvancedControlIdChange,
  onWorkflowPropsKeyDown,
}) => {
  const hasWorkflowControlBuilderChanges =
    pendingControlKeys.size !== activeControlKeys.size ||
    [...pendingControlKeys].some((key) => !activeControlKeys.has(key));

  return (
    <CollapsibleSection
      title="Props"
      defaultOpen
      action={
        selectedWorkflow ? (
          isWorkflowControlBuilderOpen ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onCancelWorkflowControlBuilder}
                className="inline-flex items-center gap-1 rounded-md border border-gray-700 px-2 py-1 text-[10px] font-medium text-gray-400 transition hover:border-gray-500 hover:text-gray-100"
              >
                <Icons.XMark className="h-3.5 w-3.5" />
                Cancel
              </button>
              <button
                type="button"
                onClick={onApplyWorkflowControlBuilder}
                disabled={!hasWorkflowControlBuilderChanges}
                className="inline-flex items-center gap-1 rounded-md border border-primary-300/20 bg-primary-300/10 px-2 py-1 text-[10px] font-medium text-primary-100 transition hover:border-primary-300/40 hover:bg-primary-300/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icons.Check className="h-3.5 w-3.5" />
                Apply
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpenWorkflowControlBuilder}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary-300/20 bg-primary-300/10 px-2 py-1 text-[10px] font-medium text-primary-100 transition hover:border-primary-300/40 hover:bg-primary-300/15"
            >
              <Icons.Plus className="h-3.5 w-3.5" />
              Fields
            </button>
          )
        ) : undefined
      }
    >
      <div className="space-y-3">
        {selectedWorkflow ? (
          isWorkflowControlBuilderOpen ? (
            <div className="space-y-3 rounded-lg border border-primary-400/20 bg-primary-400/[0.06] p-2">
              <div className="flex items-center justify-between gap-2 px-1">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-primary-50">Workflow fields</p>
                  <p className="mt-0.5 truncate text-[11px] text-primary-100/60">
                    {pendingControlKeys.size} shown · {controlCandidates.length} editable
                  </p>
                </div>
              </div>

              {controlCandidates.length > 0 ? (
                <ScrollArea
                  axis="y"
                  viewportClassName="max-h-64 rounded-lg border border-primary-300/10 bg-gray-950/60"
                  contentClassName="space-y-1 p-1 pr-3"
                >
                  {controlCandidates.map((candidate) => {
                    const isPending = pendingControlKeys.has(candidate.key);
                    return (
                      <button
                        key={candidate.key}
                        type="button"
                        onClick={() => onToggleWorkflowControlCandidate(candidate.key)}
                        aria-pressed={isPending}
                        className={`flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-2 text-left transition ${
                          isPending
                            ? 'bg-primary-300/10 text-primary-50'
                            : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-100'
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            isPending
                              ? 'border-primary-300/50 bg-primary-300/10 text-primary-100'
                              : 'border-gray-700'
                          }`}
                        >
                          {isPending && <Icons.Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">
                            {candidate.label}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-gray-500">
                            {candidate.classType} · #{candidate.nodeId} · {candidate.inputName}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </ScrollArea>
              ) : (
                <div className="rounded-lg border border-dashed border-primary-300/15 bg-gray-950/60 p-3 text-xs leading-5 text-primary-100/60">
                  This workflow does not expose editable primitive fields.
                </div>
              )}
            </div>
          ) : activeWorkflowControls.length > 0 ? (
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

                return (
                  <AttentionPulse
                    key={control.id}
                    activeKey={applyNoticeKey}
                    data-ai-apply-control-id={control.id}
                    className="rounded-lg"
                  >
                    <PropertyField
                      label={hasEnumOptions ? control.label : undefined}
                      description={hasEnumOptions ? description : undefined}
                      actions={
                        hasEnumOptions ? (
                          <>
                            {isSelectedEnumOptionMissing ? (
                              <span
                                className="shrink-0 rounded-md border border-red-200/20 bg-black/20 px-1.5 py-0.5 font-mono text-[10px] text-red-100/70"
                                title="Selected option is missing"
                              >
                                Missing
                              </span>
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
                              searchText: isMissingOption ? `${String(option)} missing` : undefined,
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
                          onChange={(value) => onUpdateWorkflowControl(control.id, { value }, true)}
                          onReset={() => onResetWorkflowControl(control.id)}
                          resetTooltip={getControlResetTooltip(control)}
                          displayFormatter={formatControlValue}
                          valuePrefix={
                            supportsRunMode ? (
                              <WorkflowRunModeBadge
                                control={control}
                                rollToken={runRollTokens[control.id] ?? 0}
                                onUpdate={(updates) =>
                                  onUpdateWorkflowControl(control.id, updates, true)
                                }
                              />
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
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <ToggleSwitch
                              label={control.label}
                              description={description}
                              checked={booleanValue}
                              onCheckedChange={(checked) =>
                                onUpdateWorkflowControl(control.id, {
                                  value: checked,
                                })
                              }
                              ariaLabel={control.label}
                              title={booleanValue ? 'Enabled' : 'Disabled'}
                              size="sm"
                            />
                          </div>
                          <ResetIconButton
                            onClick={() => onResetWorkflowControl(control.id)}
                            tooltip={getControlResetTooltip(control)}
                          />
                        </div>
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
                  </AttentionPulse>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-700 bg-gray-900/70 p-3 text-xs leading-5 text-gray-400">
              No workflow props are shown yet. Use Fields to choose which workflow inputs appear
              here.
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
};
