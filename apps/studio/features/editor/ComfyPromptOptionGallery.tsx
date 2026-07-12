import { useMemo } from 'react';
import * as Icons from '@blackboard/icons';
import { EditorTab, type AiChatPromptPreviewArtifact } from '@blackboard/types';
import { Spinner } from '@blackboard/ui';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { isComfyNode } from '@/nodes/helpers';
import { requestRegisteredNodeExecution } from '@/utils/nodeExecutionRegistry';
import {
  getActiveComfyOutputJobs,
  getComfyGenerationGroupOutputs,
  getPendingComfyOutputSlots,
} from '@/nodes/ai/comfy/comfyOutputGallery';
import { ComfyOutputGalleryStrip } from '@/nodes/ai/comfy/components/ComfyOutputGalleryStrip';
import { useComfyOutputActivation } from '@/nodes/ai/comfy/useComfyOutputActivation';

interface ComfyPromptOptionGalleryProps {
  messageId: string;
  artifact: AiChatPromptPreviewArtifact;
  onSelectOption: (option: string) => void;
}

export const getPromptOptionGenerationGroupId = (messageId: string, optionIndex: number) =>
  `prompt-option:${messageId}:${optionIndex}`;

export function ComfyPromptOptionGallery({
  messageId,
  artifact,
  onSelectOption,
}: ComfyPromptOptionGalleryProps) {
  const nodes = useEditorSelector((state) => state.nodes);
  const backgroundJobs = useEditorSelector((state) => state.backgroundJobs);
  const projectId = useEditorSelector((state) => state.projectId);
  const activeProjectBranchId = useEditorSelector((state) => state.activeProjectBranchId);
  const { requestBackgroundJobCancel, setActiveTab, setSubPanelVisible } = useEditorActions();
  const targetNodeCandidate = nodes.find((node) => node.id === artifact.target.nodeId);
  const targetNode = isComfyNode(targetNodeCandidate) ? targetNodeCandidate : null;
  const activateOutput = useComfyOutputActivation(targetNode);
  const targetControl = targetNode?.workflowControls?.find(
    (control) => control.id === artifact.target.controlId,
  );
  const targetWorkflow = targetNode?.workflows.find(
    (workflow) => workflow.id === targetControl?.workflowId,
  );
  const activeJobs = useMemo(
    () =>
      targetNode
        ? getActiveComfyOutputJobs({
            jobs: backgroundJobs,
            nodeId: targetNode.id,
            projectId,
            branchId: activeProjectBranchId,
          })
        : [],
    [activeProjectBranchId, backgroundJobs, projectId, targetNode],
  );
  const canGenerate = Boolean(targetNode && targetControl && targetWorkflow);

  const openGallery = () => {
    setSubPanelVisible(true);
    setActiveTab(EditorTab.Gallery);
  };

  return (
    <div className="space-y-2">
      {artifact.options.map((option, optionIndex) => {
        const generationGroupId = getPromptOptionGenerationGroupId(messageId, optionIndex);
        const optionOutputs = getComfyGenerationGroupOutputs(
          targetNode?.generatedOutputs ?? [],
          generationGroupId,
        );
        const optionJobs = activeJobs.filter(
          (job) => job.source?.generationGroupId === generationGroupId,
        );
        const pendingSlots = getPendingComfyOutputSlots(optionJobs);
        const isGenerating = pendingSlots.length > 0;
        const isSelected = artifact.draft === option;

        return (
          <div
            key={generationGroupId}
            className={`overflow-hidden rounded-xl border hover:border-cyan-200/25 transition ${
              isSelected
                ? 'border-cyan-200/30 bg-cyan-200/[0.1]'
                : 'border-white/[0.07] bg-white/[0.025]'
            }`}
          >
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelectOption(option)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectOption(option);
                }
              }}
              className="cursor-pointer p-2.5 transition-colors hover:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-cyan-200/25"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`min-w-0 flex-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] ${
                    isSelected ? 'text-cyan-100/75' : 'text-gray-400'
                  }`}
                >
                  Option {optionIndex + 1}
                </span>
                <button
                  type="button"
                  disabled={!canGenerate || isGenerating}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!targetNode || !targetControl || !targetWorkflow) return;
                    requestRegisteredNodeExecution(targetNode.id, {
                      source: 'chat',
                      runCount: 1,
                      workflowId: targetWorkflow.id,
                      controlValueOverrides: { [targetControl.id]: option },
                      generationGroupId,
                    });
                  }}
                  aria-label={`Generate option ${optionIndex + 1}`}
                  title={
                    canGenerate
                      ? `Generate option ${optionIndex + 1}`
                      : 'The target Comfy workflow or prompt field is unavailable'
                  }
                  className="inline-flex h-5 shrink-0 items-center gap-1 rounded-md bg-cyan-200/[0.08] px-1.5 text-xs text-cyan-50 transition hover:bg-cyan-200/[0.14] disabled:cursor-not-allowed disabled:bg-white/[0.025] disabled:text-gray-500"
                >
                  {isGenerating ? (
                    <Spinner className="h-2.5 w-2.5" />
                  ) : (
                    <Icons.Play className="h-2.5 w-2.5" />
                  )}
                  {isGenerating ? 'Generating' : 'Generate'}
                </button>
              </div>
              <span
                title={option}
                className="mt-1 block w-full truncate text-left text-[12px] normal-case tracking-normal text-gray-100"
              >
                {option}
              </span>
            </div>

            {optionOutputs.length > 0 || pendingSlots.length > 0 ? (
              <div className="mx-2.5 mb-2.5 cursor-default select-none border-t border-white/[0.07] pt-2.5">
                <ComfyOutputGalleryStrip
                  label={`Option ${optionIndex + 1} gallery`}
                  outputs={optionOutputs}
                  pendingSlots={pendingSlots}
                  activeOutputId={targetNode?.activeGeneratedOutputId}
                  fallbackActiveSrc={targetNode?.src}
                  emptyLabel="Generated previews appear here"
                  onActivateOutput={activateOutput}
                  onOpenGallery={openGallery}
                  onCancelPending={(jobId) => requestBackgroundJobCancel(jobId)}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
