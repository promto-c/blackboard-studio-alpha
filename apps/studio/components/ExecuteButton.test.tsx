// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ExecuteButton,
  ExecuteButtonAction,
  ExecuteButtonGroup,
  ExecuteButtonMenuTrigger,
} from './ExecuteButton';

describe('ExecuteButton', () => {
  it('executes its action with a caller-owned label', () => {
    const onExecute = vi.fn();
    render(<ExecuteButton onClick={onExecute}>Render</ExecuteButton>);

    fireEvent.click(screen.getByRole('button', { name: 'Render' }));

    expect(onExecute).toHaveBeenCalledOnce();
  });

  it('prevents execution when disabled', () => {
    const onExecute = vi.fn();
    render(
      <ExecuteButton disabled onClick={onExecute}>
        Generate
      </ExecuteButton>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(onExecute).not.toHaveBeenCalled();
  });

  it('supports split run and menu actions', () => {
    const onExecute = vi.fn();
    const onOpenMenu = vi.fn();
    render(
      <ExecuteButtonGroup>
        <ExecuteButtonAction onClick={onExecute}>Run</ExecuteButtonAction>
        <ExecuteButtonMenuTrigger aria-label="Run options" onClick={onOpenMenu} />
      </ExecuteButtonGroup>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run options' }));

    expect(onExecute).toHaveBeenCalledOnce();
    expect(onOpenMenu).toHaveBeenCalledOnce();
  });
});
