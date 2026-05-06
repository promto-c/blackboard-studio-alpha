// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FlowViewModeControls from './FlowViewModeControls';

describe('FlowViewModeControls', () => {
  it('calls the correct handlers for list mode controls', () => {
    const onSelectViewMode = vi.fn();
    const onToggleFlowDirection = vi.fn();
    const onAutoArrange = vi.fn();

    render(
      <FlowViewModeControls
        viewMode="list"
        flowListDirection="bottom-up"
        onSelectViewMode={onSelectViewMode}
        onToggleFlowDirection={onToggleFlowDirection}
        onAutoArrange={onAutoArrange}
      />,
    );

    fireEvent.click(screen.getByTitle('List View'));
    fireEvent.click(screen.getByTitle('Graph View'));
    fireEvent.click(screen.getByTitle('Flow Direction: Bottom to Top'));

    expect(onSelectViewMode).toHaveBeenNthCalledWith(1, 'list');
    expect(onSelectViewMode).toHaveBeenNthCalledWith(2, 'graph');
    expect(onToggleFlowDirection).toHaveBeenCalledTimes(1);
    expect(onAutoArrange).not.toHaveBeenCalled();
    expect(screen.queryByTitle('Reset Layout')).toBeNull();
  });

  it('shows reset layout only in graph mode', () => {
    const onSelectViewMode = vi.fn();
    const onToggleFlowDirection = vi.fn();
    const onAutoArrange = vi.fn();

    render(
      <FlowViewModeControls
        viewMode="graph"
        flowListDirection="top-down"
        onSelectViewMode={onSelectViewMode}
        onToggleFlowDirection={onToggleFlowDirection}
        onAutoArrange={onAutoArrange}
      />,
    );

    fireEvent.click(screen.getByTitle('Reset Layout'));

    expect(onAutoArrange).toHaveBeenCalledTimes(1);
    expect(screen.queryByTitle(/Flow Direction:/)).toBeNull();
  });
});
