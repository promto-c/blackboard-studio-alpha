// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OcioContextVariablesEditor } from './OcioContextVariablesEditor';

describe('OcioContextVariablesEditor', () => {
  it('adds, edits, renames, and removes project context variables', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <OcioContextVariablesEditor
        value={undefined}
        onChange={onChange}
        emptyLabel="No project context variables."
      />,
    );

    expect(screen.getByText('No project context variables.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Add OCIO context variable'));
    expect(onChange).toHaveBeenLastCalledWith({ CONTEXT_1: '' });

    rerender(<OcioContextVariablesEditor value={{ CONTEXT_1: '' }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('CONTEXT_1 value'), {
      target: { value: 'shot-010' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ CONTEXT_1: 'shot-010' });

    rerender(<OcioContextVariablesEditor value={{ CONTEXT_1: 'shot-010' }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('OCIO context variable name'), {
      target: { value: 'SHOT' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ SHOT: 'shot-010' });

    rerender(<OcioContextVariablesEditor value={{ SHOT: 'shot-010' }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Remove SHOT'));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});
