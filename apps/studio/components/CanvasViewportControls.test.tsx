// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasViewportControls } from './CanvasViewportControls';

describe('CanvasViewportControls', () => {
  it('shows the zoom level and exposes zoom and fit actions', () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onFit = vi.fn();
    render(
      <CanvasViewportControls
        zoom={0.75}
        minZoom={0.15}
        maxZoom={3}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onFit={onFit}
      />,
    );

    expect(screen.getByText('75%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fit to view' }));

    expect(onZoomOut).toHaveBeenCalledOnce();
    expect(onZoomIn).toHaveBeenCalledOnce();
    expect(onFit).toHaveBeenCalledOnce();
  });
});
