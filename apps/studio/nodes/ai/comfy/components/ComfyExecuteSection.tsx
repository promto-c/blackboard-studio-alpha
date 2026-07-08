import { CollapsibleSection } from '@blackboard/ui';
import { AttentionPulse, InspectorLogFooter } from '@/components';
import type { ComfyNode, GeneratedOutput } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import type { ComfyPendingOutputSlot } from '../comfyOutputGallery';
import { ComfyRunButtonGroup } from './ComfyRunButtonGroup';
import { ComfyOutputGalleryStrip } from './ComfyOutputGalleryStrip';

interface ComfyExecuteSectionProps {
  node: ComfyNode;
  outputApplyNoticeId?: string;
  pendingGeneratedOutputSlots: ComfyPendingOutputSlot[];
  recentGeneratedOutputs: GeneratedOutput[];
  outputGalleryLabel?: string;
  isRunActionDisabled: boolean;
  runShortcutHint: string;
  localError: string | null;
  hasRunProgress: boolean;
  inspectorProgressLabel: string;
  inspectorProgressPercent: number;
  inspectorProgressIndeterminate: boolean;
  inspectorLogMessage: string | null;
  onRunSingleWorkflow: () => void;
  onRunBatchWorkflow: (count: number) => void;
  onActivateGeneratedOutput: (output: GeneratedOutput) => void;
  onOpenGalleryView: () => void;
  onCancelRun: () => void;
  onCancelPendingSlot: (jobId: string) => void;
  onClearInspectorLog: () => void;
}

export function ComfyExecuteSection({
  node,
  outputApplyNoticeId,
  pendingGeneratedOutputSlots,
  recentGeneratedOutputs,
  outputGalleryLabel = 'Outputs',
  isRunActionDisabled,
  runShortcutHint,
  localError,
  hasRunProgress,
  inspectorProgressLabel,
  inspectorProgressPercent,
  inspectorProgressIndeterminate,
  inspectorLogMessage,
  onRunSingleWorkflow,
  onRunBatchWorkflow,
  onActivateGeneratedOutput,
  onOpenGalleryView,
  onCancelRun,
  onCancelPendingSlot,
  onClearInspectorLog,
}: ComfyExecuteSectionProps) {
  const runActions = (
    <ComfyRunButtonGroup
      disabled={isRunActionDisabled}
      runShortcutHint={runShortcutHint}
      onRun={onRunSingleWorkflow}
      onBatchRun={onRunBatchWorkflow}
    />
  );

  return (
    <div className="sticky bottom-0 z-20 mt-auto bg-gray-950/90 backdrop-blur-xl border-t border-white/10 supports-[backdrop-filter]:bg-gray-900/50">
      <CollapsibleSection
        title="Execute"
        defaultOpen
        action={runActions}
        collapsedAction={runActions}
      >
        <AttentionPulse
          activeKey={outputApplyNoticeId}
          className="rounded-lg border border-white/10 bg-gray-950/40 p-2"
        >
          <ComfyOutputGalleryStrip
            label={outputGalleryLabel}
            outputs={recentGeneratedOutputs}
            pendingSlots={pendingGeneratedOutputSlots}
            activeOutputId={node.activeGeneratedOutputId}
            fallbackActiveSrc={node.src}
            onActivateOutput={onActivateGeneratedOutput}
            onOpenGallery={onOpenGalleryView}
            onCancelPending={onCancelPendingSlot}
          />
        </AttentionPulse>
      </CollapsibleSection>

      <InspectorLogFooter
        label={localError ? 'Error' : hasRunProgress ? inspectorProgressLabel : 'Log'}
        message={inspectorLogMessage}
        progressIndeterminate={hasRunProgress ? inspectorProgressIndeterminate : undefined}
        progressLabel={hasRunProgress ? inspectorProgressLabel : undefined}
        progressPercent={hasRunProgress ? inspectorProgressPercent : undefined}
        variant={localError ? 'error' : 'info'}
        actions={
          hasRunProgress ? (
            <>
              <span className="font-mono text-[11px] text-primary-100/70">
                {Math.round(inspectorProgressPercent)}%
              </span>
              <button
                type="button"
                onClick={onCancelRun}
                className="rounded-md border border-primary-100/20 px-2 py-1 text-[11px] font-medium text-primary-100/75 transition hover:border-red-300/50 hover:bg-red-500/10 hover:text-red-100"
              >
                Cancel
              </button>
            </>
          ) : inspectorLogMessage ? (
            <button
              type="button"
              onClick={onClearInspectorLog}
              className="rounded-md p-1 text-gray-400 transition hover:bg-white/10 hover:text-gray-100"
              title="Clear log"
              aria-label="Clear log"
            >
              <Icons.XMark className="h-3.5 w-3.5" />
            </button>
          ) : undefined
        }
      />
    </div>
  );
}
