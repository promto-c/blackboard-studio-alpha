// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToggleSettingRow } from './ToggleSettingRow';

describe('ToggleSettingRow', () => {
  it('renders with the responsive layout and forwards changes', () => {
    const onCheckedChange = vi.fn();
    const { container } = render(
      <ToggleSettingRow label="Enabled" checked={false} onCheckedChange={onCheckedChange} />,
    );

    expect(container.querySelector('.bb-responsive-setting-row')).not.toBeNull();

    const toggle = container.querySelector('[role="switch"]');
    expect(toggle).not.toBeNull();

    fireEvent.click(toggle as HTMLElement);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
