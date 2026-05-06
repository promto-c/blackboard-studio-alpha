import React from 'react';
import { ScrollArea } from '@blackboard/ui';
import { CollapsibleSection, Popover } from '@/components';
import type { ComfyWorkflow } from '@blackboard/types';
import type { ComfyWorkflowFile } from '@/services/comfy/client';
import * as Icons from '@blackboard/icons';
import {
  formatDateTime,
  getWorkflowFileDetail,
  getWorkflowNameFromPath,
  getWorkflowNodeCount,
} from '../comfyWorkflowDisplay';

type WorkflowBrowserState = 'idle' | 'loading' | 'importing' | 'error';
type WorkflowEmptyMode = 'choice' | 'paste';

interface ComfyWorkflowPickerProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  pasteTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  selectedWorkflow: ComfyWorkflow | null;
  workflows: ComfyWorkflow[];
  workflowEmptyMode: WorkflowEmptyMode;
  workflowJsonDraft: string;
  workflowBrowserState: WorkflowBrowserState;
  backendWorkflowFiles: ComfyWorkflowFile[];
  filteredBackendWorkflowFiles: ComfyWorkflowFile[];
  backendWorkflowSearch: string;
  isBackendWorkflowPickerOpen: boolean;
  isBrowsingWorkflows: boolean;
  onImportWorkflow: React.ChangeEventHandler<HTMLInputElement>;
  onRemoveWorkflow: () => void;
  onChooseImportWorkflow: () => void;
  onChoosePasteWorkflow: () => void;
  onWorkflowEmptyModeChange: (mode: WorkflowEmptyMode) => void;
  onWorkflowJsonDraftChange: (value: string) => void;
  onImportPastedWorkflow: () => void;
  onBackendWorkflowPickerOpenChange: (open: boolean) => void;
  onBackendWorkflowSearchChange: (value: string) => void;
  onLoadBackendWorkflow: (workflowFile: ComfyWorkflowFile) => void;
  onSelectWorkflow: (workflowId: string) => void;
}

export const ComfyWorkflowPicker: React.FC<ComfyWorkflowPickerProps> = ({
  fileInputRef,
  pasteTextareaRef,
  selectedWorkflow,
  workflows,
  workflowEmptyMode,
  workflowJsonDraft,
  workflowBrowserState,
  backendWorkflowFiles,
  filteredBackendWorkflowFiles,
  backendWorkflowSearch,
  isBackendWorkflowPickerOpen,
  isBrowsingWorkflows,
  onImportWorkflow,
  onRemoveWorkflow,
  onChooseImportWorkflow,
  onChoosePasteWorkflow,
  onWorkflowEmptyModeChange,
  onWorkflowJsonDraftChange,
  onImportPastedWorkflow,
  onBackendWorkflowPickerOpenChange,
  onBackendWorkflowSearchChange,
  onLoadBackendWorkflow,
  onSelectWorkflow,
}) => (
  <CollapsibleSection title="Workflow" defaultOpen>
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
        className="hidden"
        onChange={onImportWorkflow}
      />

      {selectedWorkflow ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-white">{selectedWorkflow.name}</p>
              <p className="mt-1 text-[11px] text-gray-500">
                {getWorkflowNodeCount(selectedWorkflow)} nodes ·{' '}
                {formatDateTime(selectedWorkflow.createdAt)}
              </p>
            </div>
            <button
              type="button"
              onClick={onRemoveWorkflow}
              className="rounded-md p-1.5 text-gray-500 transition hover:bg-red-500/10 hover:text-red-300"
              title="Remove workflow"
            >
              <Icons.Trash className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border border-dashed border-gray-700 bg-gray-900/70 p-3">
          {workflowEmptyMode === 'choice' && (
            <>
              <div className="flex flex-col items-center gap-1.5 py-1 text-center">
                <p className="text-xs font-medium text-gray-300">No workflow loaded</p>
                <p className="text-[11px] leading-4 text-gray-500">
                  Import JSON/image, load from Comfy, or paste JSON.
                </p>
              </div>

              <div className="mx-auto flex w-fit max-w-full overflow-hidden rounded-lg border border-gray-700 bg-gray-950/80">
                <button
                  type="button"
                  onClick={onChooseImportWorkflow}
                  disabled={isBrowsingWorkflows}
                  className="inline-flex min-w-0 items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-gray-100 transition hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icons.ArrowUpTray className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 truncate">Import</span>
                </button>
                <Popover
                  isOpen={isBackendWorkflowPickerOpen}
                  onOpenChange={onBackendWorkflowPickerOpenChange}
                  widthClass="w-80"
                  align="start"
                  trigger={
                    <button
                      type="button"
                      disabled={workflowBrowserState === 'importing'}
                      className="inline-flex min-w-0 items-center justify-center gap-1.5 border-l border-gray-700 px-2.5 py-1.5 text-[11px] font-medium text-gray-100 transition hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Icons.FolderOpen className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 truncate">From Comfy</span>
                    </button>
                  }
                >
                  {(closeBackendWorkflowPicker) => (
                    <div className="space-y-2">
                      <input
                        value={backendWorkflowSearch}
                        onChange={(event) =>
                          onBackendWorkflowSearchChange(event.currentTarget.value)
                        }
                        placeholder="Search workflows..."
                        className="w-full rounded-lg border border-white/10 bg-gray-950/70 px-2.5 py-2 text-xs text-gray-100 outline-none transition placeholder:text-gray-600 focus:border-primary-300/60 focus:ring-2 focus:ring-primary-300/20"
                        autoFocus
                      />

                      {workflowBrowserState === 'loading' ? (
                        <p className="px-1 py-2 text-[11px] text-primary-100/60">
                          Reading workflows...
                        </p>
                      ) : backendWorkflowFiles.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-xs text-gray-500">
                          No workflows found in workflows/.
                        </p>
                      ) : filteredBackendWorkflowFiles.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-xs text-gray-500">
                          No matches
                        </p>
                      ) : (
                        <ScrollArea
                          axis="y"
                          viewportClassName="max-h-[min(18rem,calc(100vh-9rem))] pr-1"
                        >
                          <div className="space-y-1">
                            {filteredBackendWorkflowFiles.map((workflowFile) => (
                              <button
                                key={workflowFile.path}
                                type="button"
                                onClick={() => {
                                  closeBackendWorkflowPicker();
                                  onLoadBackendWorkflow(workflowFile);
                                }}
                                disabled={isBrowsingWorkflows}
                                className="w-full min-w-0 rounded-lg px-3 py-2 text-left text-sm text-gray-300 transition-all duration-150 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <span className="block truncate text-xs font-medium text-gray-100">
                                  {getWorkflowNameFromPath(workflowFile.path)}
                                </span>
                                <span className="mt-1 block truncate text-[11px] text-gray-500">
                                  {getWorkflowFileDetail(workflowFile)}
                                </span>
                              </button>
                            ))}
                          </div>
                        </ScrollArea>
                      )}
                    </div>
                  )}
                </Popover>
                <button
                  type="button"
                  onClick={() => void onChoosePasteWorkflow()}
                  disabled={isBrowsingWorkflows}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center border-l border-gray-700 text-gray-300 transition hover:bg-gray-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  title="Paste JSON"
                  aria-label="Paste JSON"
                >
                  <Icons.Paste className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          )}

          {workflowEmptyMode === 'paste' && (
            <>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onWorkflowEmptyModeChange('choice')}
                  className="rounded-md p-1.5 text-gray-500 transition hover:bg-white/5 hover:text-gray-200"
                  title="Choose another workflow source"
                  aria-label="Choose another workflow source"
                >
                  <Icons.ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <p className="min-w-0 flex-1 truncate text-[11px] font-medium text-gray-200">
                  Paste workflow JSON
                </p>
              </div>

              <ScrollArea
                axis="y"
                viewportClassName="max-h-44 rounded-md border border-gray-700 bg-black/30 transition focus-within:border-primary-400/70 focus-within:ring-2 focus-within:ring-primary-400/20"
                contentClassName="min-h-24"
              >
                <textarea
                  ref={pasteTextareaRef}
                  value={workflowJsonDraft}
                  onChange={(event) => onWorkflowJsonDraftChange(event.currentTarget.value)}
                  placeholder="Paste ComfyUI API workflow JSON..."
                  spellCheck={false}
                  rows={4}
                  className="block min-h-24 w-full resize-none overflow-hidden border-0 bg-transparent px-2 py-2 font-mono text-[11px] leading-5 text-gray-100 outline-none placeholder:text-gray-600"
                />
              </ScrollArea>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[11px] text-gray-500">
                  API format, or graph JSON with Comfy connected
                </span>
                <button
                  type="button"
                  onClick={() => void onImportPastedWorkflow()}
                  disabled={isBrowsingWorkflows || workflowJsonDraft.trim().length === 0}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-primary-300/20 bg-primary-300/10 px-2.5 py-1.5 text-[11px] font-medium text-primary-100 transition hover:border-primary-300/40 hover:bg-primary-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icons.Check className="h-3.5 w-3.5" />
                  Import JSON
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {workflows.length > 1 && (
        <ScrollArea
          axis="y"
          viewportClassName="max-h-32 rounded-lg border border-white/10 bg-gray-950/60"
          contentClassName="space-y-1 p-1 pr-3"
        >
          {workflows.map((workflow) => {
            const isSelected = workflow.id === selectedWorkflow?.id;
            return (
              <button
                key={workflow.id}
                type="button"
                onClick={() => onSelectWorkflow(workflow.id)}
                aria-pressed={isSelected}
                className={`flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition ${
                  isSelected
                    ? 'bg-primary-300/10 text-primary-50'
                    : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-100'
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    isSelected ? 'border-primary-300/50 text-primary-200' : 'border-gray-700'
                  }`}
                >
                  {isSelected && <Icons.Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{workflow.name}</span>
                <span className="shrink-0 text-gray-600">{getWorkflowNodeCount(workflow)}</span>
              </button>
            );
          })}
        </ScrollArea>
      )}
    </div>
  </CollapsibleSection>
);
