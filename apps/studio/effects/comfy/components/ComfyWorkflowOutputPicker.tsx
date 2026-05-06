import React from 'react';
import { CollapsibleSection } from '@/components';
import type { ComfyWorkflowOutputCandidate } from '@blackboard/types';
import * as Icons from '@blackboard/icons';

interface ComfyWorkflowOutputPickerProps {
  workflowOutputCandidates: ComfyWorkflowOutputCandidate[];
  selectedWorkflowOutputIds: string[];
  selectedWorkflowOutputIdSet: ReadonlySet<string>;
  hasNoSelectedWorkflowOutputs: boolean;
  onSelectAllWorkflowOutputs: () => void;
  onToggleWorkflowOutputCandidate: (candidateId: string) => void;
}

export const ComfyWorkflowOutputPicker: React.FC<ComfyWorkflowOutputPickerProps> = ({
  workflowOutputCandidates,
  selectedWorkflowOutputIds,
  selectedWorkflowOutputIdSet,
  hasNoSelectedWorkflowOutputs,
  onSelectAllWorkflowOutputs,
  onToggleWorkflowOutputCandidate,
}) => {
  if (workflowOutputCandidates.length === 0) return null;

  return (
    <CollapsibleSection
      title="Workflow Output"
      defaultOpen={workflowOutputCandidates.length > 1}
      action={
        workflowOutputCandidates.length > 1 ? (
          <button
            type="button"
            onClick={onSelectAllWorkflowOutputs}
            disabled={selectedWorkflowOutputIds.length === workflowOutputCandidates.length}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary-300/20 bg-primary-300/10 px-2 py-1 text-[10px] font-medium text-primary-100 transition hover:border-primary-300/40 hover:bg-primary-300/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icons.Check className="h-3.5 w-3.5" />
            All
          </button>
        ) : undefined
      }
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-gray-900/70 px-2.5 py-2 text-[11px]">
          <span className="min-w-0 truncate text-gray-400">
            {workflowOutputCandidates.length} image port
            {workflowOutputCandidates.length === 1 ? '' : 's'} detected
          </span>
          <span
            className={`shrink-0 font-mono ${
              selectedWorkflowOutputIds.length > 0 ? 'text-primary-100/70' : 'text-red-200/80'
            }`}
          >
            {selectedWorkflowOutputIds.length} selected
          </span>
        </div>

        <div className="space-y-1">
          {workflowOutputCandidates.map((candidate) => {
            const isSelected = selectedWorkflowOutputIdSet.has(candidate.id);
            return (
              <button
                key={candidate.id}
                type="button"
                onClick={() => onToggleWorkflowOutputCandidate(candidate.id)}
                aria-pressed={isSelected}
                className={`flex w-full min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left transition ${
                  isSelected
                    ? 'border-primary-300/30 bg-primary-300/10 text-primary-50'
                    : 'border-white/10 bg-gray-950/40 text-gray-400 hover:border-white/20 hover:bg-white/[0.04] hover:text-gray-100'
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    isSelected
                      ? 'border-primary-300/50 bg-primary-300/10 text-primary-100'
                      : 'border-gray-700'
                  }`}
                >
                  {isSelected && <Icons.Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{candidate.label}</span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-gray-500">
                    #{candidate.nodeId} · output {candidate.outputIndex + 1} ·{' '}
                    {candidate.outputName}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {hasNoSelectedWorkflowOutputs ? (
          <div className="rounded-lg border border-red-300/20 bg-red-500/10 p-2 text-[11px] leading-5 text-red-100/80">
            Select at least one output port before running this workflow.
          </div>
        ) : null}
      </div>
    </CollapsibleSection>
  );
};
