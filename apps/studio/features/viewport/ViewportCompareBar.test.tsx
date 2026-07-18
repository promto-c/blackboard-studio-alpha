// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ViewportCompareBar } from './ViewportCompareBar';

const mocks = vi.hoisted(() => ({
  useViewportCompare: vi.fn(),
}));

vi.mock('./useViewportCompare', () => ({
  useViewportCompare: mocks.useViewportCompare,
}));

vi.mock('./CompareSlotFluidCanvas', () => ({
  CompareSlotFluidCanvas: () => null,
}));

describe('ViewportCompareBar', () => {
  it('uses the pill silhouette for every sliding control in the rounded bar', () => {
    mocks.useViewportCompare.mockReturnValue({
      compareView: {
        isActive: true,
        slotA: 1,
        slotB: 2,
        sidesSwapped: false,
        mode: 'wipe',
        sizingMode: 'fit',
        wipe: {
          orientation: 'vertical',
          reference: 'cursor',
        },
      },
      swapCompareSlots: vi.fn(),
      setCompareMode: vi.fn(),
      setCompareSizingMode: vi.fn(),
      setCompareWipeOrientation: vi.fn(),
      setCompareWipeReference: vi.fn(),
    });

    const { container } = render(<ViewportCompareBar embedded />);
    const controls = Array.from(
      container.querySelectorAll<HTMLElement>('.bb-sliding-segmented-control'),
    );

    expect(controls).toHaveLength(4);
    expect(controls.every((control) => control.style.borderRadius === '9999px')).toBe(true);
    expect(
      controls.every(
        (control) => control.style.getPropertyValue('--bb-sliding-segment-radius') === '9999px',
      ),
    ).toBe(true);
  });
});
