// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToggleSettingRow } from './ToggleSettingRow';

describe('ToggleSettingRow', () => {
  it('keeps the toggle in an inline row and forwards changes', () => {
    const onCheckedChange = vi.fn();
    const { container } = render(
      <ToggleSettingRow label="Enabled" checked={false} onCheckedChange={onCheckedChange} />,
    );

    expect(container.querySelector('.bb-responsive-setting-row')).toBeNull();

    const row = container.querySelector('.flex.items-center.justify-between');
    const toggle = container.querySelector('[role="switch"]');
    expect(row?.lastElementChild).toBe(toggle);

    fireEvent.click(toggle as HTMLElement);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
