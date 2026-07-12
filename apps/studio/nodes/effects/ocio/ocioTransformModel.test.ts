import { describe, expect, it } from 'vitest';
import {
  OCIO_COMPOSITING_LOG_SPACE,
  OCIO_PROJECT_WORKING_SPACE,
  OCIO_TEXTURE_COLOR_SPACE,
  type OcioColorSpaceTransformNode,
  type OcioFileTransformNode,
  type OcioLookTransformNode,
  type OcioNamedTransformNode,
} from '@blackboard/types';
import {
  getColorSpaceNodeTransforms,
  getFileTransformNodeTransforms,
  getLookTransformNodeTransforms,
  getNamedTransformNodeTransforms,
  getOcioColorSpaceProcessingDomain,
  resolveOcioTransformColorSpace,
} from './ocioTransformModel';

const context = {
  workingColorSpace: 'ACEScg',
  textureColorSpace: 'sRGB - Texture',
  logColorSpace: 'ACEScct',
};

describe('OCIO transform node model', () => {
  it('resolves project-owned color roles without persisting config-specific names', () => {
    expect(resolveOcioTransformColorSpace(OCIO_PROJECT_WORKING_SPACE, context)).toBe('ACEScg');
    expect(resolveOcioTransformColorSpace(OCIO_TEXTURE_COLOR_SPACE, context)).toBe(
      'sRGB - Texture',
    );
    expect(resolveOcioTransformColorSpace(OCIO_COMPOSITING_LOG_SPACE, context)).toBe('ACEScct');
    expect(() =>
      resolveOcioTransformColorSpace(OCIO_COMPOSITING_LOG_SPACE, {
        ...context,
        logColorSpace: undefined,
      }),
    ).toThrow('compositing_log');
  });

  it('converts between independently selected color spaces', () => {
    expect(
      getColorSpaceNodeTransforms(
        {
          sourceColorSpace: OCIO_TEXTURE_COLOR_SPACE,
          destinationColorSpace: OCIO_COMPOSITING_LOG_SPACE,
        } as OcioColorSpaceTransformNode,
        context,
      ),
    ).toEqual([{ type: 'colorSpace', source: 'sRGB - Texture', destination: 'ACEScct' }]);
  });

  it('classifies destination encodings for graph-domain safety', () => {
    const domainContext = {
      ...context,
      colorSpaces: [
        {
          name: 'ACEScg',
          canonicalName: 'ACEScg',
          aliases: [],
          encoding: 'scene-linear',
          isData: false,
        },
        {
          name: 'Camera Log',
          canonicalName: 'Camera Log',
          aliases: ['camlog'],
          encoding: 'log',
          isData: false,
        },
      ],
    };
    expect(getOcioColorSpaceProcessingDomain(OCIO_PROJECT_WORKING_SPACE, domainContext)).toBe(
      'scene_linear',
    );
    expect(getOcioColorSpaceProcessingDomain('camlog', domainContext)).toBe('log');
    expect(getOcioColorSpaceProcessingDomain(OCIO_TEXTURE_COLOR_SPACE, domainContext)).toBe(
      'display_referred',
    );
  });

  it('sandwiches named transforms through their declared process space', () => {
    expect(
      getNamedTransformNodeTransforms(
        {
          namedTransform: 'Utility Curve',
          direction: 'inverse',
          processColorSpace: OCIO_COMPOSITING_LOG_SPACE,
        } as OcioNamedTransformNode,
        context,
      ),
    ).toEqual([
      { type: 'colorSpace', source: 'ACEScg', destination: 'ACEScct' },
      { type: 'named', name: 'Utility Curve', direction: 'inverse' },
      { type: 'colorSpace', source: 'ACEScct', destination: 'ACEScg' },
    ]);
  });

  it('builds one file-transform group with explicit input and output encodings', () => {
    expect(
      getFileTransformNodeTransforms(
        {
          assetId: 'asset_lut',
          direction: 'forward',
          interpolation: 'tetrahedral',
          inputColorSpace: OCIO_COMPOSITING_LOG_SPACE,
          outputColorSpace: OCIO_TEXTURE_COLOR_SPACE,
          cccId: 'shot-010',
        } as OcioFileTransformNode,
        context,
      ),
    ).toEqual([
      { type: 'colorSpace', source: 'ACEScg', destination: 'ACEScct' },
      {
        type: 'file',
        assetId: 'asset_lut',
        direction: 'forward',
        interpolation: 'tetrahedral',
        cccId: 'shot-010',
      },
      { type: 'colorSpace', source: 'sRGB - Texture', destination: 'ACEScg' },
    ]);
  });

  it('swaps LUT encodings when a file transform runs in inverse direction', () => {
    expect(
      getFileTransformNodeTransforms(
        {
          assetId: 'asset_lut',
          direction: 'inverse',
          interpolation: 'best',
          inputColorSpace: OCIO_COMPOSITING_LOG_SPACE,
          outputColorSpace: OCIO_TEXTURE_COLOR_SPACE,
        } as OcioFileTransformNode,
        context,
      ),
    ).toEqual([
      { type: 'colorSpace', source: 'ACEScg', destination: 'sRGB - Texture' },
      {
        type: 'file',
        assetId: 'asset_lut',
        direction: 'inverse',
        interpolation: 'best',
      },
      { type: 'colorSpace', source: 'ACEScct', destination: 'ACEScg' },
    ]);
  });

  it('keeps looks in project working-space I/O and bypasses unconfigured nodes', () => {
    expect(
      getLookTransformNodeTransforms(
        { looks: '+Show Look', direction: 'forward' } as OcioLookTransformNode,
        context,
      ),
    ).toEqual([
      {
        type: 'look',
        source: 'ACEScg',
        destination: 'ACEScg',
        looks: '+Show Look',
        direction: 'forward',
      },
    ]);
    expect(
      getLookTransformNodeTransforms(
        { looks: '', direction: 'forward' } as OcioLookTransformNode,
        context,
      ),
    ).toEqual([]);
  });
});
