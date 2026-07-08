// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_ACES_CG_CONFIG_REFERENCE } from '@/color-management';
import { OcioConfigSelector } from './OcioConfigSelector';

describe('OcioConfigSelector', () => {
  it('offers external reference and directory actions on the config header', async () => {
    const onChange = vi.fn();
    render(
      <OcioConfigSelector
        value={BUILTIN_ACES_CG_CONFIG_REFERENCE}
        builtinConfigs={[]}
        scope="project"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByLabelText('Use external OCIO config reference'));
    expect(screen.getByLabelText('OCIO config reference')).toBeTruthy();

    const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByLabelText('Locate OCIO config directory'));
    await waitFor(() => expect(inputClick).toHaveBeenCalled());
    inputClick.mockRestore();
  });
});
