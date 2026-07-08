// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultProjectColorManagement } from '@/color-management';
import { ColorManagementSettingsEditor } from './ColorManagementSettingsEditor';

vi.mock('./DisplayViewSelector', () => ({
  DisplayViewSelector: () => <div data-testid="display-view-selector" />,
  getDisplayViewSelectorModel: () => ({ issue: null }),
}));

describe('ColorManagementSettingsEditor', () => {
  it('shows OCIO context only for the explicit project scope', () => {
    const value = createDefaultProjectColorManagement();
    const props = {
      value,
      runtime: null,
      builtinConfigs: [],
      onChange: vi.fn(),
      onConfigChange: vi.fn(),
    };
    const { rerender } = render(<ColorManagementSettingsEditor {...props} scope="application" />);

    expect(screen.queryByText('OCIO Context')).toBeNull();

    rerender(<ColorManagementSettingsEditor {...props} scope="project" />);
    expect(screen.getByText('OCIO Context')).toBeTruthy();
    expect(screen.getByText('No project context variables.')).toBeTruthy();
  });
});
