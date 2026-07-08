// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InlineOptionList } from './InlineOptionList';

describe('InlineOptionList', () => {
  it('renders bare options and selects an item directly', () => {
    const onChange = vi.fn();
    render(
      <InlineOptionList
        label="Display"
        value="sRGB - Display"
        options={[
          { value: 'sRGB - Display', label: 'sRGB - Display' },
          { value: 'Display P3 - Display', label: 'Display P3 - Display' },
        ]}
        onChange={onChange}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'sRGB - Display' }).getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Display P3 - Display' }));
    expect(onChange).toHaveBeenCalledWith('Display P3 - Display');
  });
});
