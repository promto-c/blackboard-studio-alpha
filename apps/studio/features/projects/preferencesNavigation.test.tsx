// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  getDefaultPreferencesColorScope,
  PreferencesNavigationProvider,
  usePreferencesNavigation,
} from './preferencesNavigation';

function NavigationProbe() {
  const navigation = usePreferencesNavigation();
  return (
    <div>
      <div data-testid="route">
        {navigation.isOpen
          ? `${navigation.target.section}/${navigation.target.colorScope}`
          : 'closed'}
      </div>
      <button
        type="button"
        onClick={() =>
          navigation.openPreferences({
            section: 'colorManagement',
            colorScope: 'project',
          })
        }
      >
        Open project color
      </button>
    </div>
  );
}

describe('preferences navigation', () => {
  it('defaults color scope to the current project when one is open', () => {
    expect(getDefaultPreferencesColorScope('project-1')).toBe('project');
    expect(getDefaultPreferencesColorScope(null)).toBe('application');
    expect(getDefaultPreferencesColorScope('project-1', 'application')).toBe('application');
  });

  it('routes Scene properties directly to project color preferences', () => {
    render(
      <PreferencesNavigationProvider>
        <NavigationProbe />
      </PreferencesNavigationProvider>,
    );

    fireEvent.click(screen.getByText('Open project color'));
    expect(screen.getByTestId('route').textContent).toBe('colorManagement/project');
  });
});
