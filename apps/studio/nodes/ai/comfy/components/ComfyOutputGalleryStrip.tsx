import React from 'react';
import type { GeneratedOutput } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { ScrollArea } from '@blackboard/ui';
import type { ComfyPendingOutputSlot } from '../comfyOutputGallery';
import { ComfyOutputPlaceholder } from './ComfyOutputPlaceholder';
import { ComfyOutputThumbnail } from './ComfyOutputThumbnail';

interface ComfyOutputGalleryStripProps {
  label?: string;
  outputs: GeneratedOutput[];
  pendingSlots?: ComfyPendingOutputSlot[];
  activeOutputId?: string;
  fallbackActiveSrc?: string;
  emptyLabel?: string;
  onActivateOutput: (output: GeneratedOutput) => void;
  onOpenGallery: () => void;
  onCancelPending?: (slotId: string) => void;
}

export function ComfyOutputGalleryStrip({
  label = 'Outputs',
  outputs,
  pendingSlots = [],
  activeOutputId,
  fallbackActiveSrc,
  emptyLabel = 'Run output thumbnails appear here',
  onActivateOutput,
  onOpenGallery,
  onCancelPending,
}: ComfyOutputGalleryStripProps) {
  const [scrollViewport, setScrollViewport] = React.useState<HTMLDivElement | null>(null);
  const hasOutputSlots = outputs.length > 0 || pendingSlots.length > 0;

  return (
    <div>
      <div className="mb-1.5 flex min-h-6 items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
          {label}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className="font-mono text-[10px] tabular-nums text-gray-600"
            aria-label={`${outputs.length} ${outputs.length === 1 ? 'output' : 'outputs'}`}
          >
            {outputs.length}
          </span>
          <button
            type="button"
            onClick={onOpenGallery}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-primary-300/20 bg-primary-300/[0.05] px-1.5 text-[10px] font-medium text-primary-100/75 transition hover:border-primary-300/40 hover:bg-primary-300/10 hover:text-primary-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-300/60"
            title="Open Gallery"
          >
            <Icons.Photo className="h-3 w-3" />
            <span>More</span>
          </button>
        </div>
      </div>
      {hasOutputSlots ? (
        <ScrollArea
          ref={setScrollViewport}
          axis="x"
          rootClassName="min-w-0"
          viewportClassName="touch-pan-x pb-1.5"
          contentClassName="flex w-max min-w-full snap-x snap-proximity gap-1.5"
          role="region"
          aria-label={`${label} thumbnails`}
          tabIndex={0}
        >
          {pendingSlots.map((slot) => (
            <ComfyOutputPlaceholder
              key={slot.id}
              label={slot.label}
              detail={slot.detail}
              active={slot.active}
              onClick={onCancelPending ? () => onCancelPending(slot.jobId) : undefined}
            />
          ))}
          {outputs.map((output) => (
            <ComfyOutputThumbnail
              key={output.id}
              output={output}
              active={
                activeOutputId ? activeOutputId === output.id : fallbackActiveSrc === output.src
              }
              scrollRoot={scrollViewport}
              onClick={() => onActivateOutput(output)}
            />
          ))}
        </ScrollArea>
      ) : (
        <div className="flex h-14 min-w-0 items-center justify-center rounded-md border border-dashed border-white/10 bg-gray-900/60 px-3 text-center text-[11px] text-gray-500">
          {emptyLabel}
        </div>
      )}
    </div>
  );
}
