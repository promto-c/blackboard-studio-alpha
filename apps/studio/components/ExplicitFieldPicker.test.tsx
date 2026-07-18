// @vitest-environment jsdom

import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExplicitFieldPicker, type ExplicitFieldPickerField } from './ExplicitFieldPicker';

const fields: ExplicitFieldPickerField[] = [
  {
    id: 'sampler:strength',
    label: 'Strength',
    group: 'Sampler',
    detail: '#12',
    searchText: 'cfg denoise',
  },
  {
    id: 'sampler:seed',
    label: 'Seed',
    selectedLabel: 'Render seed',
    group: 'Sampler',
    detail: '#12',
  },
];

function Fixture() {
  const [selectedFieldIds, setSelectedFieldIds] = useState<ReadonlySet<string>>(
    () => new Set(['sampler:seed']),
  );

  return (
    <ExplicitFieldPicker
      fields={fields}
      selectedFieldIds={selectedFieldIds}
      onToggleField={(fieldId) => {
        setSelectedFieldIds((current) => {
          const next = new Set(current);
          if (next.has(fieldId)) next.delete(fieldId);
          else next.add(fieldId);
          return next;
        });
      }}
      totalLabel="2 editable"
    />
  );
}

describe('ExplicitFieldPicker', () => {
  it('searches and toggles available and shown fields without closing', () => {
    render(<Fixture />);

    fireEvent.click(screen.getByRole('button', { name: 'Fields, 1 of 2 shown' }));
    expect(screen.getByText('Sampler')).toBeTruthy();
    expect(screen.getByText('2 editable')).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search fields' }), {
      target: { value: 'cfg' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show Strength from Sampler' }));

    expect(screen.getByText('2 shown')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide Strength from Sampler' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Hide Strength from Sampler' }));
    expect(screen.getByText('1 shown')).toBeTruthy();
  });

  it('shows a useful no-match state', () => {
    render(<Fixture />);

    fireEvent.click(screen.getByRole('button', { name: 'Fields, 1 of 2 shown' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search fields' }), {
      target: { value: 'missing field' },
    });

    expect(screen.getByText('No fields match "missing field"')).toBeTruthy();
  });
});
