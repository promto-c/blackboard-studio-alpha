import React from 'react';
import type { GeneratedOutput } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import type { ComfyPendingOutputSlot } from '../comfyOutputGallery';
import { ComfyOutputPlaceholder } from './ComfyOutputPlaceholder';
import { ComfyOutputThumbnail } from './ComfyOutputThumbnail';

const OUTPUT_TILE_SIZE_PX = 56;
const OUTPUT_TILE_GAP_PX = 6;
const DEFAULT_VISIBLE_OUTPUT_SLOTS = 5;

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
  const [outputStripElement, setOutputStripElement] = React.useState<HTMLDivElement | null>(null);
  const [visibleOutputSlots, setVisibleOutputSlots] = React.useState(DEFAULT_VISIBLE_OUTPUT_SLOTS);
  const visibleOutputs = React.useMemo(() => {
    const availableSlots = Math.max(0, visibleOutputSlots - pendingSlots.length);
    return outputs.slice(0, availableSlots);
  }, [outputs, pendingSlots.length, visibleOutputSlots]);

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
    const resizeObserver = new ResizeObserver(updateVisibleOutputSlots);
    resizeObserver.observe(outputStrip);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [outputStripElement]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
          {label}
        </span>
        <span className="font-mono text-[10px] text-gray-600">{outputs.length}</span>
      </div>
      <div className="flex min-w-0 gap-1.5">
        <div ref={setOutputStripElement} className="flex min-w-0 flex-1 gap-1.5 overflow-hidden">
          {pendingSlots.map((slot) => (
            <ComfyOutputPlaceholder
              key={slot.id}
              label={slot.label}
              detail={slot.detail}
              active={slot.active}
              onClick={onCancelPending ? () => onCancelPending(slot.jobId) : undefined}
            />
          ))}
          {visibleOutputs.length > 0 ? (
            visibleOutputs.map((output) => (
              <ComfyOutputThumbnail
                key={output.id}
                output={output}
                active={
                  activeOutputId ? activeOutputId === output.id : fallbackActiveSrc === output.src
                }
                onClick={() => onActivateOutput(output)}
              />
            ))
          ) : outputs.length === 0 && pendingSlots.length === 0 ? (
            <div className="flex h-14 min-w-0 flex-1 items-center justify-center rounded-md border border-dashed border-white/10 bg-gray-900/60 px-3 text-center text-[11px] text-gray-500">
              {emptyLabel}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onOpenGallery}
          className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-md border border-dashed border-primary-300/25 bg-primary-300/[0.05] text-primary-100/70 transition hover:border-primary-300/50 hover:bg-primary-300/10 hover:text-primary-100"
          title="Open Gallery"
        >
          <Icons.Photo className="h-4 w-4" />
          <span className="mt-0.5 text-[10px] font-medium">More</span>
        </button>
      </div>
    </div>
  );
}
