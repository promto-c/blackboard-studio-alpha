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
});
