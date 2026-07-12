// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ViewportCompareOverlays,
  type ViewportCompareOverlaysProps,
} from './ViewportCompareOverlays';

const baseProps: ViewportCompareOverlaysProps = {
  visible: true,
  mode: 'wipe',
  orientation: 'vertical',
  wipeDividerViewportPos: 320,
  compareInteractiveViewportRect: { x: 0, y: 0, width: 640, height: 360 },
};

describe('ViewportCompareOverlays', () => {
  it.each(['wipe', 'split'] as const)('hides the %s divider when overlays are off', (mode) => {
    const { container } = render(
      <ViewportCompareOverlays {...baseProps} mode={mode} visible={false} />,
    );

    expect(container.firstElementChild).toBeNull();
  });

  it.each(['wipe', 'split'] as const)('shows the %s divider when overlays are on', (mode) => {
    const { container } = render(<ViewportCompareOverlays {...baseProps} mode={mode} visible />);

    expect(container.firstElementChild).not.toBeNull();
  });
});
