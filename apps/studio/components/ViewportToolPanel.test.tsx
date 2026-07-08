// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ViewportToolPanel,
  ViewportToolPanelArea,
  ViewportToolPanelSection,
  ViewportToolPanelSectionStack,
} from './ViewportToolPanel';

vi.mock('@blackboard/ui', () => ({
  ScrollArea: ({
    axis,
    children,
    fadeEdges,
    rootClassName,
  }: {
    axis: string;
    children: React.ReactNode;
    fadeEdges: boolean | { backdropBlur?: number; size?: number };
    rootClassName: string;
  }) => (
    <div
      className={rootClassName}
      data-axis={axis}
      data-edge-blur={typeof fadeEdges === 'object' ? fadeEdges.backdropBlur : undefined}
      data-edge-fade-size={typeof fadeEdges === 'object' ? fadeEdges.size : undefined}
      data-fade-edges={Boolean(fadeEdges)}
      data-testid="tool-panel-scroll-area"
    >
      {children}
    </div>
  ),
  SplitterHandle: ({ onChange }: { onChange: (value: number) => void }) => (
    <button type="button" onClick={() => onChange(400)}>
      Resize tool panels
    </button>
  ),
  ToggleSwitch: () => null,
}));

describe('ViewportToolPanelArea', () => {
  it('keeps the full-height layout transparent and owns a uniform resizable width', () => {
    render(
      <ViewportToolPanelArea>
        <ViewportToolPanel>First</ViewportToolPanel>
        <ViewportToolPanel>Second</ViewportToolPanel>
      </ViewportToolPanelArea>,
    );

    const scrollArea = screen.getByTestId('tool-panel-scroll-area');
    expect(scrollArea.dataset.axis).toBe('y');
    expect(scrollArea.dataset.fadeEdges).toBe('true');
    expect(scrollArea.dataset.edgeBlur).toBe('16');
    expect(scrollArea.dataset.edgeFadeSize).toBe('32');

    fireEvent.click(screen.getByRole('button', { name: 'Resize tool panels' }));

    expect(screen.getByRole('group', { name: 'Viewport tool panels' }).style.width).toBe('400px');
  });

  it('contains pointer input inside a visible panel surface', () => {
    const onPointerDown = vi.fn();

    render(
      <div onPointerDown={onPointerDown}>
        <ViewportToolPanel>Controls</ViewportToolPanel>
      </div>,
    );

    fireEvent.pointerDown(screen.getByText('Controls'));

    expect(onPointerDown).not.toHaveBeenCalled();
  });
});
