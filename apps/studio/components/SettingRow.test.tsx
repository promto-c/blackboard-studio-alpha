// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SettingRow } from './SettingRow';

describe('SettingRow', () => {
  it('uses the responsive layout by default', () => {
    const { container } = render(
      <SettingRow label="Timeline Start">
        <input aria-label="Timeline Start" />
      </SettingRow>,
    );

    const row = container.querySelector('.bb-responsive-setting-row');
    expect(row).not.toBeNull();
    expect(row?.querySelector('.bb-responsive-setting-row__content')).not.toBeNull();
  });

  it('supports an explicit compact inline layout', () => {
    const { container } = render(
      <SettingRow label="Visible" layout="inline">
        <button type="button">Toggle</button>
      </SettingRow>,
    );

    expect(container.firstElementChild?.classList.contains('flex')).toBe(true);
    expect(container.querySelector('.bb-responsive-setting-row')).toBeNull();
  });
});
