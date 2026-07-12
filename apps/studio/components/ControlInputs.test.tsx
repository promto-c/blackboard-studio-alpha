// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ColorInput, TextInput } from '@blackboard/ui';

describe('shared control inputs', () => {
  it('uses the default app control surface for text values', () => {
    const onValueChange = vi.fn();
    render(<TextInput aria-label="Name" value="Camera" onValueChange={onValueChange} />);

    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input.className).toContain('bb-control-input');

    fireEvent.change(input, { target: { value: 'Main Camera' } });
    expect(onValueChange).toHaveBeenCalledWith('Main Camera');
  });

  it('uses the same control surface for compact color values', () => {
    const onValueChange = vi.fn();
    render(<ColorInput aria-label="Color" value="#38bdf8" onValueChange={onValueChange} />);

    const input = screen.getByLabelText('Color');
    expect(input.className).toContain('bb-control-input');

    fireEvent.change(input, { target: { value: '#ffffff' } });
    expect(onValueChange).toHaveBeenCalledWith('#ffffff');
  });
});
