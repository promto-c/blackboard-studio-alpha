import React from 'react';
import { CollapsibleSection } from '@/components';
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
  connectedWorkflowInputs: ConnectedComfyWorkflowInput[];
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

export const ComfyWorkflowInputList: React.FC<ComfyWorkflowInputListProps> = ({
  selectedWorkflow,
  workflowInputCandidates,
  connectedWorkflowInputs,
  onImportWorkflowInputImage,
  onClearWorkflowInputImage,
}) => {
  if (workflowInputCandidates.length === 0) return null;

  return (
    <CollapsibleSection title="Workflow Inputs" defaultOpen={workflowInputCandidates.length > 1}>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-gray-900/70 px-2.5 py-2 text-[11px]">
          <span className="min-w-0 truncate text-gray-400">
            {workflowInputCandidates.length} image input
            {workflowInputCandidates.length === 1 ? '' : 's'} detected
          </span>
          <span className="shrink-0 font-mono text-primary-100/70">
            {connectedWorkflowInputs.filter((entry) => entry.sourceNode).length} connected ·{' '}
            {connectedWorkflowInputs.filter((entry) => entry.inputImage).length} loaded
          </span>
        </div>

        <div className="space-y-1">
          {connectedWorkflowInputs.map(({ candidate, sourceNode, inputImage }) => {
            const hasInput = Boolean(sourceNode || inputImage);
            const activeSourceLabel = sourceNode
              ? sourceNode.name
              : inputImage
                ? inputImage.name
                : 'Unconnected';
            const activeSourceKind = sourceNode ? 'Port' : inputImage ? 'Loaded' : 'None';

            return (
              <div
                key={candidate.id}
                className={`flex w-full min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left ${
                  hasInput
                    ? 'border-primary-300/25 bg-primary-300/10 text-primary-50'
                    : 'border-white/10 bg-gray-950/40 text-gray-400'
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    hasInput
                      ? 'border-primary-300/50 bg-primary-300/10 text-primary-100'
                      : 'border-gray-700'
                  }`}
                >
                  {hasInput ? (
                    <Icons.Check className="h-3 w-3" />
                  ) : (
                    <Icons.Photo className="h-3 w-3" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{candidate.label}</span>
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
                    className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-primary-300/20 bg-primary-300/10 px-2 text-[11px] font-medium text-primary-100 transition hover:border-primary-300/40 hover:bg-primary-300/15"
                    title={`Load image for ${candidate.label}`}
                  >
                    <Icons.ArrowUpTray className="h-3.5 w-3.5" />
                    Load
                    <input
                      type="file"
                      accept={IMAGE_IMPORT_ACCEPT}
                      className="hidden"
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
};
