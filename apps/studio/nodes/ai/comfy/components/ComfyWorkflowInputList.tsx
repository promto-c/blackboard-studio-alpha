import React from 'react';
import { Badge, CollapsibleSection } from '@blackboard/ui';
import type {
  AnyNode,
  ComfyWorkflow,
  ComfyWorkflowInputCandidate,
  ComfyWorkflowInputImage,
} from '@blackboard/types';
import { IMAGE_IMPORT_ACCEPT } from '@/utils/mediaFiles';
import * as Icons from '@blackboard/icons';

export interface ConnectedComfyWorkflowInput {
  candidate: ComfyWorkflowInputCandidate;
  portName: string;
  sourceNode: AnyNode | null;
  inputImage: ComfyWorkflowInputImage | null;
}

interface ComfyWorkflowInputListProps {
  selectedWorkflow: ComfyWorkflow;
  workflowInputCandidates: ComfyWorkflowInputCandidate[];
  selectedWorkflowInputIdSet: ReadonlySet<string>;
  connectedWorkflowInputs: ConnectedComfyWorkflowInput[];
  onToggleWorkflowInputCandidate: (candidateId: string) => void;
  onImportWorkflowInputImage: (
    workflow: ComfyWorkflow,
    candidate: ComfyWorkflowInputCandidate,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => void;
  onClearWorkflowInputImage: (
    workflow: ComfyWorkflow,
    candidate: ComfyWorkflowInputCandidate,
  ) => void;
}

export function ComfyWorkflowInputList({
  selectedWorkflow,
  workflowInputCandidates,
  selectedWorkflowInputIdSet,
  connectedWorkflowInputs,
  onToggleWorkflowInputCandidate,
  onImportWorkflowInputImage,
  onClearWorkflowInputImage,
}: ComfyWorkflowInputListProps) {
  if (workflowInputCandidates.length === 0) return null;

  return (
    <CollapsibleSection title="Workflow Inputs" defaultOpen={workflowInputCandidates.length > 1}>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-gray-900/70 px-2.5 py-2 text-[11px]">
          <span className="min-w-0 truncate text-gray-400">
            {workflowInputCandidates.length} input port
            {workflowInputCandidates.length === 1 ? '' : 's'} available
          </span>
          <span className="shrink-0 font-mono text-primary-100/70">
            {selectedWorkflowInputIdSet.size} shown ·{' '}
            {
              connectedWorkflowInputs.filter(
                (entry) =>
                  selectedWorkflowInputIdSet.has(entry.candidate.id) &&
                  (entry.sourceNode || entry.inputImage),
              ).length
            }{' '}
            ready
          </span>
        </div>

        <div className="space-y-1">
          {connectedWorkflowInputs.map(({ candidate, sourceNode, inputImage }) => {
            const isSelected = selectedWorkflowInputIdSet.has(candidate.id);
            const activeSourceLabel = !isSelected
              ? 'Port hidden'
              : sourceNode
                ? sourceNode.name
                : inputImage
                  ? inputImage.name
                  : 'Unconnected';
            const activeSourceKind = !isSelected
              ? 'Unchecked'
              : sourceNode
                ? 'Port'
                : inputImage
                  ? 'Loaded'
                  : 'None';

            return (
              <div
                key={candidate.id}
                className={`flex w-full min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left ${
                  isSelected
                    ? 'border-primary-300/25 bg-primary-300/10 text-primary-50'
                    : 'border-white/10 bg-gray-950/40 text-gray-400'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onToggleWorkflowInputCandidate(candidate.id)}
                  aria-pressed={isSelected}
                  aria-label={`${isSelected ? 'Hide' : 'Show'} ${candidate.label} input port`}
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    isSelected
                      ? 'border-primary-300/50 bg-primary-300/10 text-primary-100'
                      : 'border-gray-700'
                  }`}
                >
                  {isSelected ? <Icons.Check className="h-3 w-3" /> : null}
                </button>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-xs font-medium">{candidate.label}</span>
                    {candidate.scope === 'internal' ? (
                      <Badge size="sm" variant="neutral">
                        Internal
                      </Badge>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-gray-500">
                    #{candidate.nodeId} · {candidate.inputName}
                  </span>
                </span>
                <span className="min-w-0 shrink basis-28 text-right">
                  <span className="block truncate text-[11px] text-gray-300">
                    {activeSourceLabel}
                  </span>
                  <span className="block text-[10px] uppercase tracking-wide text-gray-500">
                    {activeSourceKind}
                  </span>
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <label
                    className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition ${
                      isSelected
                        ? 'cursor-pointer border-primary-300/20 bg-primary-300/10 text-primary-100 hover:border-primary-300/40 hover:bg-primary-300/15'
                        : 'cursor-not-allowed border-white/5 text-gray-600'
                    }`}
                    title={`Load image for ${candidate.label}`}
                  >
                    <Icons.ArrowDownTray className="h-3.5 w-3.5" />
                    Load
                    <input
                      type="file"
                      accept={IMAGE_IMPORT_ACCEPT}
                      className="hidden"
                      disabled={!isSelected}
                      onChange={(event) =>
                        onImportWorkflowInputImage(selectedWorkflow, candidate, event)
                      }
                    />
                  </label>
                  {inputImage ? (
                    <button
                      type="button"
                      onClick={() => onClearWorkflowInputImage(selectedWorkflow, candidate)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-gray-400 transition hover:border-red-300/40 hover:bg-red-300/10 hover:text-red-100"
                      title={`Clear loaded image for ${candidate.label}`}
                      aria-label={`Clear loaded image for ${candidate.label}`}
                    >
                      <Icons.Trash className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </CollapsibleSection>
  );
}
