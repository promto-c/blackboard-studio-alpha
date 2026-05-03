// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ItemsPanelLayout from './ItemsPanelLayout';

describe('ItemsPanelLayout', () => {
  it('handles Ctrl+A and Cmd+A as select all', () => {
    const onSelectAll = vi.fn();

    render(
      <ItemsPanelLayout
        title="Items"
        hasItems
        onSelectAll={onSelectAll}
        emptyState={<div>Empty</div>}
      >
        <div>Rows</div>
      </ItemsPanelLayout>,
    );

    const panel = screen.getByText('Rows').closest('[tabindex="-1"]');
    expect(panel).not.toBeNull();

    fireEvent.keyDown(panel!, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(panel!, { key: 'a', metaKey: true });

    expect(onSelectAll).toHaveBeenCalledTimes(2);
  });

  it('does not intercept select all while typing in a text input', () => {
    const onSelectAll = vi.fn();

    render(
      <ItemsPanelLayout
        title="Items"
        hasItems
        onSelectAll={onSelectAll}
        emptyState={<div>Empty</div>}
      >
        <input aria-label="Filter items" />
      </ItemsPanelLayout>,
    );

    fireEvent.keyDown(screen.getByLabelText('Filter items'), { key: 'a', ctrlKey: true });

    expect(onSelectAll).not.toHaveBeenCalled();
  });
});
