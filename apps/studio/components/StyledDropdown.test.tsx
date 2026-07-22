// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SplitControl, SplitControlAction, StyledDropdown } from '@blackboard/ui';

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
    expect(screen.getByRole('option', { name: /Alpha/ }).className).toContain('bg-primary-500/15');
    expect(screen.getByRole('option', { name: /Beta/ }).className).toContain('bg-white/[0.09]');

    fireEvent.keyDown(trigger, { key: 'Enter' });

    expect(screen.getByRole('button', { name: /Beta/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('composes a searchable creatable dropdown inside a split control', () => {
    const onCreate = vi.fn();
    const onDelete = vi.fn();
    const onSync = vi.fn();

    render(
      <SplitControl>
        <div>
          <StyledDropdown
            value="main"
            options={[
              { value: 'main', label: 'main' },
              {
                value: 'feature',
                label: 'feature',
                trailingAction: {
                  label: 'Delete branch feature',
                  icon: <span>×</span>,
                  onSelect: onDelete,
                },
              },
            ]}
            onChange={() => undefined}
            searchable
            searchPlaceholder="Find or create branch"
            createOption={{
              isAvailable: (query) => query !== 'main' && query !== 'feature',
              label: (query) => `Create branch "${query}"`,
              onCreate,
            }}
          />
        </div>
        <SplitControlAction aria-label="Push project" onClick={onSync}>
          ↑
        </SplitControlAction>
      </SplitControl>,
    );

    const trigger = screen.getByRole('button', { name: /main/i });
    fireEvent.click(trigger);
    const searchInput = screen.getByRole('combobox');
    expect(searchInput.className).toContain('pl-7');
    expect(searchInput.parentElement?.querySelector('svg')).toBeTruthy();
    fireEvent.change(searchInput, { target: { value: 'review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create branch "review"' }));
    expect(onCreate).toHaveBeenCalledWith('review');

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Delete branch feature' }));
    expect(onDelete).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Push project' }));
    expect(onSync).toHaveBeenCalledOnce();
  });

  it('supports a space-efficient toolbar density for split controls', () => {
    render(
      <SplitControl density="toolbar">
        <StyledDropdown
          value="main"
          options={[{ value: 'main', label: 'main' }]}
          onChange={() => undefined}
          density="toolbar"
        />
        <SplitControlAction aria-label="Sync branch">↑</SplitControlAction>
      </SplitControl>,
    );

    const trigger = screen.getByRole('button', { name: /main/i });
    expect(trigger.className).toContain('bb-control-toolbar');
    expect(trigger.closest('.bb-split-control')?.className).toContain('bb-control-toolbar');
  });
});
