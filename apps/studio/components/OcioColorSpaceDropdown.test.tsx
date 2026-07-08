// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OcioColorSpaceDropdown } from './OcioColorSpaceDropdown';

vi.mock('@blackboard/ui', () => ({
  StyledDropdown: ({ value }: { value: string | number }) => (
    <div data-testid="dropdown-value">{String(value)}</div>
  ),
}));

vi.mock('@/state/ocioContext', () => ({
  useOcio: () => ({
    isInitialized: true,
    error: null,
    colorSpaces: [
      {
        name: 'sRGB Encoded Rec.709 (sRGB)',
        canonicalName: 'sRGB Encoded Rec.709 (sRGB)',
        aliases: [],
        categories: [],
        family: 'Utility',
        encoding: 'sdr-video',
        description: '',
        isData: false,
      },
    ],
    resolveColorSpaceName: (value: string) => value,
  }),
}));

describe('OcioColorSpaceDropdown', () => {
  it('shows an unselected control instead of silently substituting a default space', () => {
    render(<OcioColorSpaceDropdown value={undefined} onChange={() => undefined} />);

    expect(screen.getByTestId('dropdown-value').textContent).toBe('');
  });
});
