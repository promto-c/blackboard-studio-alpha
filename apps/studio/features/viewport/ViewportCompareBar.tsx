import React, { useRef, useState } from 'react';
import * as Icons from '@blackboard/icons';
import {
  SlidingSegmentedControl,
  type SlidingSegmentedControlOption,
} from '@/components/SlidingSegmentedControl';
import { useViewportCompare } from './useViewportCompare';
import { CompareSlotFluidCanvas } from './CompareSlotFluidCanvas';
import type { CompareSizingMode } from '@/state/editor/compareView';

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

const SIZING_OPTIONS: SlidingSegmentedControlOption<CompareSizingMode>[] = [
  {
    value: 'fit',
    label: 'Fit',
    Icon: Icons.Rectangle,
    title: 'Fit — show the entire display window with letterboxing',
  },
  {
    value: 'fill',
    label: 'Fill',
    Icon: Icons.ArrowsPointingOut,
    title: 'Fill — cover each pane while preserving aspect ratio',
  },
  {
    value: 'none',
    label: 'None',
    Icon: Icons.Pixelate,
    title: 'None — show native pixels at 100% without automatic scaling',
  },
];

const REFERENCE_OPTIONS: SlidingSegmentedControlOption<'canvas' | 'viewport' | 'cursor'>[] = [
  {
    value: 'cursor',
    label: 'Cursor',
    Icon: Icons.CursorArrow,
    title: 'Follows cursor',
  },
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
];

export function ViewportCompareBar({ embedded }: { embedded?: boolean } = {}) {
  const {
    compareView,
    swapCompareSlots,
    setCompareMode,
    setCompareSizingMode,
    setCompareWipeOrientation,
    setCompareWipeReference,
  } = useViewportCompare();

  const barRef = useRef<HTMLDivElement>(null);
  const [fluidHovered, setFluidHovered] = useState(false);

  if (!compareView.isActive) return null;

  const barContent = (
    <div className="glass-component flex items-center gap-2 bg-gray-900/60 backdrop-blur-xl border border-white/10 rounded-full shadow-xl ring-1 ring-inset ring-white/20 px-3 py-1.5">
      <button
        type="button"
        className="compare-slot-swap"
        data-swapped={compareView.sidesSwapped ? 'true' : 'false'}
        onClick={swapCompareSlots}
        onPointerEnter={() => setFluidHovered(true)}
        onPointerLeave={() => setFluidHovered(false)}
        onFocus={() => setFluidHovered(true)}
        onBlur={() => setFluidHovered(false)}
        aria-label={`Swap comparison sides: viewer slot ${compareView.sidesSwapped ? compareView.slotB : compareView.slotA} with viewer slot ${compareView.sidesSwapped ? compareView.slotA : compareView.slotB}`}
        title="Swap Comparison Sides"
      >
        <span aria-hidden="true" className="compare-slot-swap__chamber">
          <CompareSlotFluidCanvas hovered={fluidHovered} swapped={compareView.sidesSwapped} />
          <span className="compare-slot-swap__caustic" />
          <span className="compare-slot-swap__specular" />
        </span>
        <span
          className="compare-slot-swap__slot compare-slot-swap__slot--base"
          title={`Viewer Slot ${compareView.slotA} · Base`}
        >
          {compareView.slotA}
        </span>
        <span className="compare-slot-swap__action" aria-hidden="true">
          <span className="compare-slot-swap__versus">vs</span>
          <Icons.ArrowsRightLeft className="compare-slot-swap__icon" />
        </span>
        <span
          className="compare-slot-swap__slot compare-slot-swap__slot--comparison"
          title={`Viewer Slot ${compareView.slotB} · Comparison`}
        >
          {compareView.slotB}
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
        shape="pill"
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
        shape="pill"
        iconClassName="h-3.5 w-3.5"
        labelMaxWidthClassName="max-w-16"
      />

      <div className="w-px h-5 bg-white/10 mx-1" />

      <SlidingSegmentedControl
        options={SIZING_OPTIONS}
        value={compareView.sizingMode}
        onChange={setCompareSizingMode}
        activeWidth={58}
        inactiveWidth={28}
        height={28}
        shape="pill"
        iconClassName="h-3.5 w-3.5"
        labelMaxWidthClassName="max-w-10"
        ariaLabel="Compare pane sizing"
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
            shape="pill"
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
