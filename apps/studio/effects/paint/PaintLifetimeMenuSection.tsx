import React, { useEffect, useMemo, useState } from 'react';
import type { PaintLifetime } from '@blackboard/types';
import { MenuSectionLabel, SegmentedControl } from '@/components';
import { clampPaintFrame, normalizePaintLifetime } from './paintLifetime';

const FRAME_INPUT_CLASS =
  'bg-gray-900/70 text-gray-100 text-xs rounded-md focus:outline-none focus:ring-2 focus:ring-offset-0 focus:ring-offset-gray-900 focus:ring-primary-700 block px-2.5 py-2 font-mono w-full border border-white/10';
const SECONDARY_BUTTON_CLASS =
  'rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-2 text-[11px] font-medium text-gray-300 transition-colors hover:bg-white/[0.08]';
const PRIMARY_BUTTON_CLASS =
  'w-full rounded-md bg-primary-500/20 px-3 py-2 text-xs font-medium text-primary-100 ring-1 ring-inset ring-primary-500/30 transition-colors hover:bg-primary-500/28';

const LIFETIME_MODE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'single', label: 'Frame' },
  { value: 'range', label: 'Range' },
] as const;

interface PaintLifetimeMenuSectionProps {
  lifetime?: PaintLifetime | null;
  currentFrame: number;
  maxFrames: number;
  onApply: (lifetime: PaintLifetime) => void;
}

function PaintLifetimeMenuSection({
  lifetime,
  currentFrame,
  maxFrames,
  onApply,
}: PaintLifetimeMenuSectionProps) {
  const normalizedLifetime = useMemo(() => normalizePaintLifetime(lifetime), [lifetime]);
  const [mode, setMode] = useState<PaintLifetime['mode']>(normalizedLifetime.mode);
  const [singleFrame, setSingleFrame] = useState(
    normalizedLifetime.mode === 'single' ? normalizedLifetime.frame : clampPaintFrame(currentFrame),
  );
  const [rangeStart, setRangeStart] = useState(
    normalizedLifetime.mode === 'range'
      ? normalizedLifetime.startFrame
      : clampPaintFrame(currentFrame),
  );
  const [rangeEnd, setRangeEnd] = useState(
    normalizedLifetime.mode === 'range'
      ? normalizedLifetime.endFrame
      : clampPaintFrame(currentFrame),
  );

  useEffect(() => {
    setMode(normalizedLifetime.mode);
    setSingleFrame(
      normalizedLifetime.mode === 'single'
        ? normalizedLifetime.frame
        : clampPaintFrame(currentFrame),
    );
    setRangeStart(
      normalizedLifetime.mode === 'range'
        ? normalizedLifetime.startFrame
        : clampPaintFrame(currentFrame),
    );
    setRangeEnd(
      normalizedLifetime.mode === 'range'
        ? normalizedLifetime.endFrame
        : clampPaintFrame(currentFrame),
    );
  }, [currentFrame, normalizedLifetime]);

  const applyLifetime = () => {
    if (mode === 'all') {
      onApply({ mode: 'all' });
      return;
    }

    if (mode === 'single') {
      onApply({
        mode: 'single',
        frame: clampPaintFrame(singleFrame, maxFrames),
      });
      return;
    }

    const startFrame = clampPaintFrame(rangeStart, maxFrames);
    const endFrame = clampPaintFrame(rangeEnd, maxFrames);

    onApply({
      mode: 'range',
      startFrame: Math.min(startFrame, endFrame),
      endFrame: Math.max(startFrame, endFrame),
    });
  };

  return (
    <div className="space-y-2">
      <MenuSectionLabel>Lifetime</MenuSectionLabel>
      <SegmentedControl
        options={LIFETIME_MODE_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
        value={mode}
        onChange={(value) => setMode(value as PaintLifetime['mode'])}
      />

      {mode === 'single' ? (
        <div className="space-y-2">
          <label className="space-y-1">
            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-gray-500">
              Frame
            </span>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                type="number"
                value={singleFrame}
                min={0}
                max={maxFrames}
                step={1}
                onChange={(event) =>
                  setSingleFrame(clampPaintFrame(Number(event.target.value), maxFrames))
                }
                className={FRAME_INPUT_CLASS}
              />
              <button
                type="button"
                onClick={() => setSingleFrame(clampPaintFrame(currentFrame, maxFrames))}
                className={SECONDARY_BUTTON_CLASS}
              >
                Use Playhead
              </button>
            </div>
          </label>
        </div>
      ) : null}

      {mode === 'range' ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-gray-500">
              Start
            </span>
            <input
              type="number"
              value={rangeStart}
              min={0}
              max={maxFrames}
              step={1}
              onChange={(event) =>
                setRangeStart(clampPaintFrame(Number(event.target.value), maxFrames))
              }
              className={FRAME_INPUT_CLASS}
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-gray-500">
              End
            </span>
            <input
              type="number"
              value={rangeEnd}
              min={0}
              max={maxFrames}
              step={1}
              onChange={(event) =>
                setRangeEnd(clampPaintFrame(Number(event.target.value), maxFrames))
              }
              className={FRAME_INPUT_CLASS}
            />
          </label>
        </div>
      ) : null}

      <div className="flex items-center justify-between text-[10px] text-gray-500">
        <span>Playhead {currentFrame}</span>
        {mode === 'range' ? <span>Inclusive</span> : null}
      </div>

      <button type="button" onClick={applyLifetime} className={PRIMARY_BUTTON_CLASS}>
        Apply Lifetime
      </button>
    </div>
  );
}

export default PaintLifetimeMenuSection;
