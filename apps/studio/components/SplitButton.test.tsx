// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SplitButton } from './SplitButton';

describe('SplitButton', () => {
  it('keeps the primary action separate from its menu', () => {
    const onClick = vi.fn();

    render(
      <SplitButton
        onClick={onClick}
        menu={<div>Alignment settings content</div>}
        menuLabel="Open settings"
      >
        Align to Input
      </SplitButton>,
    );

    expect(screen.queryByText('Alignment settings content')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(screen.getByText('Alignment settings content')).not.toBeNull();
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Align to Input' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.queryByText('Alignment settings content')).toBeNull();
  });
});
