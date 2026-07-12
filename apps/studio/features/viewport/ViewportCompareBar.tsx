import React, { useRef } from 'react';
import * as Icons from '@blackboard/icons';
import {
  SlidingSegmentedControl,
  type SlidingSegmentedControlOption,
} from '@/components/SlidingSegmentedControl';
import { useViewportCompare } from './useViewportCompare';

const MODE_OPTIONS: SlidingSegmentedControlOption<'wipe' | 'split'>[] = [
  { value: 'wipe', label: 'Wipe', Icon: Icons.CompareWipe, title: 'Wipe Compare' },
  { value: 'split', label: 'Split', Icon: Icons.CompareSplit, title: 'Split Compare' },
];

const ORIENTATION_OPTIONS: SlidingSegmentedControlOption<'vertical' | 'horizontal'>[] = [
  { value: 'vertical', label: 'Vertical', Icon: Icons.CompareDividerVertical, title: 'Vertical' },
  {
    value: 'horizontal',
    label: 'Horizontal',
    Icon: Icons.CompareDividerHorizontal,
    title: 'Horizontal',
  },
];

const REFERENCE_OPTIONS: SlidingSegmentedControlOption<'canvas' | 'viewport' | 'cursor'>[] = [
  {
    value: 'canvas',
    label: 'Canvas',
    Icon: Icons.Rectangle,
    title: 'Canvas space (moves with content)',
  },
  {
    value: 'viewport',
    label: 'Viewport',
    Icon: Icons.ComputerDesktop,
    title: 'Screen space (fixed position)',
  },
  {
    value: 'cursor',
    label: 'Cursor',
    Icon: Icons.CursorArrow,
    title: 'Follows cursor',
  },
];

export function ViewportCompareBar({ embedded }: { embedded?: boolean } = {}) {
  const {
    compareView,
    swapCompareSlots,
    setCompareMode,
    setCompareWipeOrientation,
    setCompareWipeReference,
  } = useViewportCompare();

  const barRef = useRef<HTMLDivElement>(null);

  if (!compareView.isActive) return null;

  const barContent = (
    <div className="glass-component flex items-center gap-2 bg-gray-900/60 backdrop-blur-xl border border-white/10 rounded-full shadow-xl ring-1 ring-inset ring-white/20 px-3 py-1.5">
      {/* Slot badge — the whole area is clickable to swap */}
      <button
        type="button"
        onClick={swapCompareSlots}
        title="Swap Sides"
        className="group relative flex h-7 min-w-[62px] items-center justify-center overflow-hidden rounded-full border border-white/15 bg-gradient-to-r from-primary-500/70 via-slate-700/65 to-amber-500/70 px-2.5 text-[11px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_4px_12px_rgba(0,0,0,0.22)] ring-1 ring-inset ring-white/10 transition hover:border-white/25 hover:brightness-110"
      >
        <span className="pointer-events-none absolute inset-px rounded-full bg-gradient-to-b from-white/14 to-transparent" />
        <span className="relative flex items-center gap-1.5">
          <span>{compareView.slotA}</span>
          <span className="relative flex min-w-3 items-center justify-center text-[9px] font-black uppercase text-white/75">
            <span className="group-hover:invisible">vs</span>
            <Icons.ArrowsRightLeft className="invisible absolute h-3 w-3 text-white/85 group-hover:visible" />
          </span>
          <span>{compareView.slotB}</span>
        </span>
      </button>

      <div className="w-px h-5 bg-white/10 mx-1" />

      {/* Wipe / Split toggle */}
      <SlidingSegmentedControl
        options={MODE_OPTIONS}
        value={compareView.mode}
        onChange={setCompareMode}
        activeWidth={68}
        inactiveWidth={28}
        height={28}
        iconClassName="h-3.5 w-3.5"
        labelMaxWidthClassName="max-w-12"
      />

      {/* Orientation — controls wipe direction for wipe mode, layout direction for split mode */}
      <SlidingSegmentedControl
        options={ORIENTATION_OPTIONS}
        value={compareView.wipe.orientation}
        onChange={setCompareWipeOrientation}
        activeWidth={80}
        inactiveWidth={28}
        height={28}
        iconClassName="h-3.5 w-3.5"
        labelMaxWidthClassName="max-w-16"
      />

      {/* Wipe-mode only: reference selector */}
      {compareView.mode === 'wipe' && (
        <>
          <div className="w-px h-5 bg-white/10 mx-1" />
          <SlidingSegmentedControl
            options={REFERENCE_OPTIONS}
            value={compareView.wipe.reference}
            onChange={setCompareWipeReference}
            activeWidth={88}
            inactiveWidth={28}
            height={28}
            iconClassName="h-3.5 w-3.5"
            labelMaxWidthClassName="max-w-16"
          />
        </>
      )}
    </div>
  );

  if (embedded) {
    return barContent;
  }

  return (
    <div
      ref={barRef}
      className="absolute bottom-20 left-1/2 -translate-x-1/2 z-40 pointer-events-auto animate-[fadeIn_150ms_ease-out]"
    >
      {barContent}
    </div>
  );
}
