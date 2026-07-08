import { describe, expect, it } from 'vitest';
import {
  createUserMediaColorManagementOverride,
  resetMediaColorManagementToAutomatic,
} from './media';
import {
  createBrowserDecodedVideoColorManagement,
  createDecodedVideoColorManagement,
  createVideoColorMetadata,
} from './videoMetadata';

describe('video color metadata', () => {
  it('represents unavailable browser metadata explicitly', () => {
    expect(createVideoColorMetadata()).toEqual({
      primaries: null,
      transfer: null,
      matrix: null,
      range: null,
      source: 'unavailable',
    });
  });

  it('normalizes decoder and container vocabulary into one model', () => {
    expect(
      createVideoColorMetadata({
        primaries: 'rec709',
        transfer: 'iec61966-2-1',
        matrix: 'identity',
        fullRange: true,
        source: 'decoder',
      }),
    ).toEqual({
      primaries: 'bt709',
      transfer: 'srgb',
      matrix: 'rgb',
      range: 'full',
      source: 'decoder',
    });

    expect(
      createVideoColorMetadata({
        primaries: 'smpte-eg-432-1',
        transfer: 'smpte2084',
        matrix: 'bt2020_ncl',
        range: 'tv',
        source: 'container',
      }),
    ).toEqual({
      primaries: 'display-p3',
      transfer: 'pq',
      matrix: 'bt2020-ncl',
      range: 'limited',
      source: 'container',
    });
  });

  it('does not guess unsupported or missing metadata values', () => {
    expect(
      createVideoColorMetadata({
        primaries: 'unknown-vendor-primary',
        transfer: '',
        matrix: null,
        range: 'unspecified',
        source: 'container',
      }),
    ).toEqual({
      primaries: null,
      transfer: null,
      matrix: null,
      range: null,
      source: 'container',
    });
  });

  it('models browser-decoded RGB as one automatic source transform', () => {
    const decoded = createBrowserDecodedVideoColorManagement();

    expect(decoded).toMatchObject({
      assignmentSource: 'decoder',
      isData: false,
      evidence: {
        automatic: {
          assignmentSource: 'decoder',
        },
      },
    });
    expect(decoded.evidence?.automatic.detail).toContain('already applied');

    const overridden = createUserMediaColorManagementOverride(decoded, 'ACEScg');
    expect(resetMediaColorManagementToAutomatic(overridden)).toEqual(decoded);
  });

  it('uses the same decoded-RGB contract for a future native backend', () => {
    expect(
      createDecodedVideoColorManagement(
        'Linear Rec.2020',
        'Native decoder output after YUV and range conversion',
      ),
    ).toMatchObject({
      sourceColorSpace: 'Linear Rec.2020',
      assignmentSource: 'decoder',
      evidence: {
        automatic: {
          sourceColorSpace: 'Linear Rec.2020',
          assignmentSource: 'decoder',
          detail: 'Native decoder output after YUV and range conversion',
        },
      },
    });
  });
});
