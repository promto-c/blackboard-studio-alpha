import { describe, expect, it } from 'vitest';
import { getUnavailableOptionalRoles } from './roles';

const colorSpaces = [
  { name: 'ACEScg', canonicalName: 'ACEScg' },
  { name: 'Raw', canonicalName: 'Raw' },
];

describe('OCIO role diagnostics', () => {
  it('ignores optional roles Studio does not consume', () => {
    expect(
      getUnavailableOptionalRoles(
        [
          {
            name: 'cie_xyz_d65_interchange',
            colorSpace: 'CIE XYZ-D65 - Display-referred',
          },
        ],
        colorSpaces,
      ),
    ).toEqual([]);
  });

  it('reports missing optional roles used by Studio processing', () => {
    expect(
      getUnavailableOptionalRoles(
        [
          {
            name: 'compositing_log',
            colorSpace: 'Missing Log Space',
          },
        ],
        colorSpaces,
      ),
    ).toEqual([
      {
        name: 'compositing_log',
        colorSpace: 'Missing Log Space',
        message:
          'Optional OCIO role "compositing_log" references missing color space "Missing Log Space".',
      },
    ]);
  });
});
