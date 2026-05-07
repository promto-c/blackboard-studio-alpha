import React from 'react';
import { AttentionPulse, CollapsibleSection, InspectorLogFooter, Popover } from '@/components';
import type { ComfyNode, GeneratedOutput } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { ComfyOutputPlaceholder } from './ComfyOutputPlaceholder';
import { ComfyOutputThumbnail } from './ComfyOutputThumbnail';

const BATCH_RUN_COUNTS = [2, 4, 8, 16] as const;
const OUTPUT_TILE_SIZE_PX = 56;
const OUTPUT_TILE_GAP_PX = 6;
const DEFAULT_VISIBLE_OUTPUT_SLOTS = 5;

interface PendingGeneratedOutputSlot {
  id: string;
  label: string;
  detail?: string;
  active: boolean;
}

const ComfyRunButtonGroup: React.FC<{
  disabled: boolean;
  isRunMenuOpen: boolean;
  runShortcutHint: string;
  onRun: () => void;
  onRunMenuOpenChange: (open: boolean) => void;
  onBatchRun: (count: number) => void;
}> = ({ disabled, isRunMenuOpen, runShortcutHint, onRun, onRunMenuOpenChange, onBatchRun }) => (
  <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-primary-300/20 bg-primary-300/10 text-primary-100 transition hover:border-primary-300/40">
    <button
      type="button"
      onClick={onRun}
      disabled={disabled}
      title={`Run workflow (${runShortcutHint})`}
      className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 px-2 py-1 text-[10px] font-medium transition hover:bg-primary-300/15 disabled:cursor-not-allowed disabled:bg-gray-900/70 disabled:text-gray-500"
    >
      <Icons.Play className="h-3.5 w-3.5" />
      Run
    </button>
    <Popover
      isOpen={disabled ? false : isRunMenuOpen}
      onOpenChange={(open) => {
        if (disabled) return;
        onRunMenuOpenChange(open);
      }}
      align="end"
      widthClass="w-36"
      trigger={
        <button
          type="button"
          disabled={disabled}
          className="inline-flex h-full items-center justify-center border-l border-primary-300/20 px-1.5 transition hover:bg-primary-300/15 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-900/70 disabled:text-gray-500"
          title="Run batch"
          aria-label="Run batch"
        >
          <Icons.ChevronDown className="h-3.5 w-3.5" />
        </button>
      }
    >
      {(closePopover) => (
        <div className="space-y-1">
          <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
            Batch Run
          </p>
          {BATCH_RUN_COUNTS.map((count) => (
            <button
              key={count}
              type="button"
              onClick={() => {
                closePopover();
                onBatchRun(count);
              }}
              className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs text-gray-300 transition hover:bg-white/[0.06] hover:text-white"
            >
              <span>{count} runs</span>
              <span className="font-mono text-[11px] text-gray-500">x{count}</span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  </div>
);

interface ComfyExecuteSectionProps {
  node: ComfyNode;
  outputApplyNoticeId?: string;
  pendingGeneratedOutputSlots: PendingGeneratedOutputSlot[];
  recentGeneratedOutputs: GeneratedOutput[];
  isRunActionDisabled: boolean;
  isRunMenuOpen: boolean;
  runShortcutHint: string;
  localError: string | null;
  hasRunProgress: boolean;
  inspectorProgressLabel: string;
  inspectorProgressPercent: number;
  inspectorProgressIndeterminate: boolean;
  inspectorLogMessage: string | null;
  onRunSingleWorkflow: () => void;
  onRunBatchWorkflow: (count: number) => void;
  onRunMenuOpenChange: (open: boolean) => void;
  onActivateGeneratedOutput: (output: GeneratedOutput) => void;
  onOpenGalleryView: () => void;
  onCancelRun: () => void;
  onClearInspectorLog: () => void;
}

export const ComfyExecuteSection: React.FC<ComfyExecuteSectionProps> = ({
  node,
  outputApplyNoticeId,
  pendingGeneratedOutputSlots,
  recentGeneratedOutputs,
  isRunActionDisabled,
  isRunMenuOpen,
  runShortcutHint,
  localError,
  hasRunProgress,
  inspectorProgressLabel,
  inspectorProgressPercent,
  inspectorProgressIndeterminate,
  inspectorLogMessage,
  onRunSingleWorkflow,
  onRunBatchWorkflow,
  onRunMenuOpenChange,
  onActivateGeneratedOutput,
  onOpenGalleryView,
  onCancelRun,
  onClearInspectorLog,
}) => {
  const [outputStripElement, setOutputStripElement] = React.useState<HTMLDivElement | null>(null);
  const [visibleOutputSlots, setVisibleOutputSlots] = React.useState(DEFAULT_VISIBLE_OUTPUT_SLOTS);
  const visibleRecentOutputs = React.useMemo(() => {
    const availableSlots = Math.max(0, visibleOutputSlots - pendingGeneratedOutputSlots.length);
    return recentGeneratedOutputs.slice(0, availableSlots);
  }, [pendingGeneratedOutputSlots.length, recentGeneratedOutputs, visibleOutputSlots]);

  React.useEffect(() => {
    const outputStrip = outputStripElement;
    if (!outputStrip) return;

    const updateVisibleOutputSlots = () => {
      const width = outputStrip.getBoundingClientRect().width;
      if (width <= 0) return;

      const nextSlots = Math.max(
        1,
        Math.floor((width + OUTPUT_TILE_GAP_PX) / (OUTPUT_TILE_SIZE_PX + OUTPUT_TILE_GAP_PX)) + 1,
      );
      setVisibleOutputSlots((currentSlots) =>
        currentSlots === nextSlots ? currentSlots : nextSlots,
      );
    };

    updateVisibleOutputSlots();
    const animationFrame = window.requestAnimationFrame(updateVisibleOutputSlots);

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateVisibleOutputSlots);
      return () => {
        window.cancelAnimationFrame(animationFrame);
        window.removeEventListener('resize', updateVisibleOutputSlots);
      };
    }

    const resizeObserver = new ResizeObserver(updateVisibleOutputSlots);
    resizeObserver.observe(outputStrip);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [outputStripElement]);

  const runActions = (
    <ComfyRunButtonGroup
      disabled={isRunActionDisabled}
      isRunMenuOpen={isRunMenuOpen}
      runShortcutHint={runShortcutHint}
      onRun={onRunSingleWorkflow}
      onRunMenuOpenChange={onRunMenuOpenChange}
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
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
              Outputs
            </span>
            <span className="font-mono text-[10px] text-gray-600">
              {(node.generatedOutputs ?? []).filter((output) => !output.deletedAt).length}
            </span>
          </div>
          <div className="flex min-w-0 gap-1.5">
            <div
              ref={setOutputStripElement}
              className="flex min-w-0 flex-1 gap-1.5 overflow-hidden"
            >
              {pendingGeneratedOutputSlots.map((slot) => (
                <ComfyOutputPlaceholder
                  key={slot.id}
                  label={slot.label}
                  detail={slot.detail}
                  active={slot.active}
                />
              ))}
              {visibleRecentOutputs.length > 0 ? (
                visibleRecentOutputs.map((output) => (
                  <ComfyOutputThumbnail
                    key={output.id}
                    output={output}
                    active={
                      node.activeGeneratedOutputId
                        ? node.activeGeneratedOutputId === output.id
                        : node.src === output.src
                    }
                    onClick={() => onActivateGeneratedOutput(output)}
                  />
                ))
              ) : recentGeneratedOutputs.length === 0 &&
                pendingGeneratedOutputSlots.length === 0 ? (
                <div className="flex h-14 min-w-0 flex-1 items-center justify-center rounded-md border border-dashed border-white/10 bg-gray-900/60 px-3 text-center text-[11px] text-gray-500">
                  Run output thumbnails appear here
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onOpenGalleryView}
              className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-md border border-dashed border-primary-300/25 bg-primary-300/[0.05] text-primary-100/70 transition hover:border-primary-300/50 hover:bg-primary-300/10 hover:text-primary-100"
              title="Open Gallery"
            >
              <Icons.Photo className="h-4 w-4" />
              <span className="mt-0.5 text-[10px] font-medium">More</span>
            </button>
          </div>
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
};
