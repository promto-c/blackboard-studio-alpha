import { describe, expect, it, vi } from 'vitest';
import {
  getExrColorSpaceMetadataCandidate,
  parseExrColorMetadata,
  resolveImportedMediaColorManagement,
} from './mediaMetadata';

describe('media color metadata', () => {
  it('extracts an explicit OCIO color-space attribute', () => {
    expect(getExrColorSpaceMetadataCandidate({ ocioColorSpace: ' ACEScg ' })).toEqual({
      sourceColorSpace: 'ACEScg',
      detail: 'EXR ocioColorSpace metadata',
    });
  });

  it('does not invent an assignment from unrelated metadata', () => {
    expect(getExrColorSpaceMetadataCandidate({ owner: 'Blackboard Studio' })).toBeNull();
  });

  it('recognizes ACES container metadata and typed attributes', () => {
    expect(
      parseExrColorMetadata({
        acesImageContainerFlag: { type: 'int', value: 1 },
        cameraMake: { type: 'string', value: 'ARRI' },
        cameraModel: 'ALEXA 35',
      }),
    ).toEqual({
      candidate: {
        sourceColorSpace: 'ACES2065-1',
        detail: 'EXR ACES image-container metadata',
      },
      camera: {
        vendor: 'ARRI',
        model: 'ALEXA 35',
        serial: undefined,
      },
    });
  });

  it('recognizes AP1 chromaticities and keeps camera/profile evidence centralized', () => {
    const chromaticities = {
      redX: 0.713,
      redY: 0.293,
      greenX: 0.165,
      greenY: 0.83,
      blueX: 0.128,
      blueY: 0.044,
      whiteX: 0.32168,
      whiteY: 0.33767,
    };

    expect(
      parseExrColorMetadata({
        chromaticities: { type: 'chromaticities', value: chromaticities },
        iccProfileName: 'Studio profile',
        cameraManufacturer: 'Sony',
        cameraSerialNumber: 'A001',
      }),
    ).toEqual({
      candidate: {
        sourceColorSpace: 'ACEScg',
        detail: 'EXR ACES AP1 chromaticities',
      },
      camera: {
        vendor: 'Sony',
        model: undefined,
        serial: 'A001',
      },
      imageProfile: 'Studio profile',
      chromaticities,
    });
  });

  it('resolves validated metadata and file-rule candidates through one pipeline', async () => {
    const resolveConfiguredColorSpaceName = vi.fn((value: string) => value);
    const resolveFileRule = vi.fn(() => ({
      sourceColorSpace: 'ACES2065-1',
      ruleName: 'EXR',
      isDefaultRule: false,
      detail: 'OCIO file rule: EXR',
    }));

    await expect(
      resolveImportedMediaColorManagement({
        blob: new Blob(),
        fileName: 'plate.png',
        isOpenExr: false,
        resolveConfiguredColorSpaceName,
        resolveFileRule,
      }),
    ).resolves.toMatchObject({
      assignmentSource: 'file_rule',
      sourceColorSpace: 'ACES2065-1',
      evidence: {
        automatic: {
          assignmentSource: 'file_rule',
          ruleName: 'EXR',
          isDefaultRule: false,
        },
      },
    });
    expect(resolveConfiguredColorSpaceName).toHaveBeenCalledWith('ACES2065-1');
    expect(resolveFileRule).toHaveBeenCalledWith('plate.png');
  });
});
