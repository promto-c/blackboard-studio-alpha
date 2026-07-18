// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ViewportToolButton } from './ViewportToolButton';

describe('ViewportToolButton', () => {
  it('places the settings affordance below the tool when requested', () => {
    const onToolClick = vi.fn();
    const onSettingsClick = vi.fn();

    render(
      <ViewportToolButton
        label="Working Area"
        icon={<span>Icon</span>}
        onClick={onToolClick}
        onSettingsClick={onSettingsClick}
        settingsPlacement="bottom"
      />,
    );

    const toolButton = screen.getByRole('button', { name: 'Working Area' });
    const settingsButton = screen.getByRole('button', { name: 'Show settings' });

    expect(settingsButton.className).toContain('left-1/2');
    expect(settingsButton.className).toContain('top-11');
    expect(settingsButton.className).toContain('h-4');
    expect(settingsButton.className).toContain('w-8');
    expect(settingsButton.className).toContain('rounded-b-md');
    expect(settingsButton.className).toContain('focus:outline-0');
    expect(settingsButton.className).toContain('focus:outline-offset-0');
    expect(settingsButton.className).not.toContain('focus:outline-none');
    expect(settingsButton.className).toContain('group-focus-within:opacity-100');

    fireEvent.click(toolButton);
    expect(onToolClick).toHaveBeenCalledOnce();
    expect(onSettingsClick).not.toHaveBeenCalled();

    fireEvent.click(settingsButton);
    expect(onSettingsClick).toHaveBeenCalledOnce();
    expect(onToolClick).toHaveBeenCalledOnce();
  });
});
