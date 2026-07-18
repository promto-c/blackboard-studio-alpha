// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as Icons from '@blackboard/icons';
import { SlidingSegmentedControl } from './SlidingSegmentedControl';

describe('SlidingSegmentedControl', () => {
  it('applies the pill silhouette to the track, selection, and segments', () => {
    const { container } = render(
      <SlidingSegmentedControl
        options={[
          { value: 'wipe', label: 'Wipe', Icon: Icons.CompareWipe },
          { value: 'split', label: 'Split', Icon: Icons.CompareSplit },
        ]}
        value="wipe"
        onChange={vi.fn()}
        shape="pill"
        ariaLabel="Compare mode"
      />,
    );

    const control = container.querySelector<HTMLElement>('.bb-sliding-segmented-control');
    expect(control?.style.borderRadius).toBe('9999px');
    expect(control?.style.getPropertyValue('--bb-sliding-segment-radius')).toBe('9999px');
    expect(screen.getByRole('button', { name: 'Wipe' }).style.borderRadius).toBe('9999px');
    expect(screen.getByRole('button', { name: 'Split' }).style.borderRadius).toBe('9999px');
  });

  it('prevents selecting a disabled segment', () => {
    const onChange = vi.fn();

    render(
      <SlidingSegmentedControl
        options={[
          { value: 'chat', label: 'Chat', Icon: Icons.ChatBubble },
          { value: 'agent', label: 'Agent', Icon: Icons.Branch, disabled: true },
        ]}
        value="chat"
        onChange={onChange}
        activeIconClassName="text-primary-300"
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Chat' }).querySelector('svg')?.className.baseVal,
    ).toContain('text-primary-300');
    const agentButton = screen.getByRole('button', { name: 'Agent' });
    expect((agentButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(agentButton);
    expect(onChange).not.toHaveBeenCalled();
  });
});
