// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_ACES_CG_CONFIG_REFERENCE } from '@/color-management';
import {
  createLocatedExternalConfigReference,
  ExternalConfigReferenceField,
} from './ExternalConfigReferenceField';

describe('ExternalConfigReferenceField', () => {
  it('creates scope-specific references for located config directories', () => {
    expect(createLocatedExternalConfigReference('application', 'show/config.ocio')).toEqual({
      kind: 'external',
      uri: 'app:///show/config.ocio',
    });
    expect(createLocatedExternalConfigReference('project', 'show/config.ocio')).toEqual({
      kind: 'external',
      uri: 'project:///show/config.ocio',
    });
  });

  it('applies an external path without changing the referenced file', () => {
    const onChange = vi.fn();
    render(
      <ExternalConfigReferenceField value={BUILTIN_ACES_CG_CONFIG_REFERENCE} onChange={onChange} />,
    );

    fireEvent.change(screen.getByLabelText('OCIO config reference'), {
      target: { value: '/facility/show/config.ocio' },
    });
    fireEvent.click(screen.getByLabelText('Use external config reference'));

    expect(onChange).toHaveBeenCalledWith({
      kind: 'external',
      uri: '/facility/show/config.ocio',
    });
  });

  it('removes only the project reference and restores the bundled config', () => {
    const onChange = vi.fn();
    render(
      <ExternalConfigReferenceField
        value={{ kind: 'external', uri: 'file:///show/config.ocio' }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByLabelText('Remove external reference'));

    expect(onChange).toHaveBeenCalledWith(BUILTIN_ACES_CG_CONFIG_REFERENCE);
  });
});
