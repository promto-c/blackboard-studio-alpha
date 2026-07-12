// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { StyledDropdown } from '@blackboard/ui';

const options = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'beta', label: 'Beta' },
  { value: 'gamma', label: 'Gamma' },
];

function DropdownHarness() {
  const [value, setValue] = useState('alpha');
  return (
    <StyledDropdown value={value} options={options} onChange={(next) => setValue(String(next))} />
  );
}

describe('StyledDropdown keyboard selection', () => {
  it('applies arrow selection directly while the focused menu is closed', () => {
    render(<DropdownHarness />);
    const trigger = screen.getByRole('button', { name: /Alpha/ });

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: /Beta/ })).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('button', { name: /Beta/ }), { key: 'ArrowUp' });
    expect(screen.getByRole('button', { name: /Alpha/ })).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('button', { name: /Alpha/ }), { key: 'ArrowUp' });
    expect(screen.getByRole('button', { name: /Gamma/ })).toBeTruthy();
  });

  it('navigates without applying while the menu is open, then commits with Enter', () => {
    render(<DropdownHarness />);
    const trigger = screen.getByRole('button', { name: /Alpha/ });
    fireEvent.click(trigger);

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('option', { name: /Alpha/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('option', { name: /Beta/ }).className).toContain('bg-white/[0.09]');

    fireEvent.keyDown(trigger, { key: 'Enter' });

    expect(screen.getByRole('button', { name: /Beta/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });
});
