import { describe, expect, it } from 'vitest';
import { classifyDataChannel, isDataChannel, type DataChannelSemantic } from './dataChannels';

describe('data channel classification', () => {
  it.each([
    ['A', 'alpha'],
    ['alpha', 'alpha'],
    ['mask', 'mask'],
    ['beauty_matte.R', 'mask'],
    ['Z', 'depth'],
    ['depth.Z', 'depth'],
    ['N.x', 'normal'],
    ['normal.z', 'normal'],
    ['motion_vector.x', 'motion_vector'],
    ['velocity.y', 'motion_vector'],
    ['uv.u', 'uv'],
    ['st.v', 'uv'],
    ['P.x', 'position'],
    ['worldPosition.y', 'position'],
    ['object_id', 'id'],
    ['materialId', 'id'],
    ['crypto_object00', 'cryptomatte'],
    ['cryptomatte/material', 'cryptomatte'],
    ['roughness', 'material_property'],
    ['metallic', 'material_property'],
    ['displacement.height', 'material_property'],
  ] as const)('classifies %s as %s data', (channelName, semantic) => {
    expect(classifyDataChannel(channelName)).toEqual({
      isData: true,
      semantic: semantic as DataChannelSemantic,
    });
    expect(isDataChannel(channelName)).toBe(true);
  });

  it.each(['beauty.R', 'diffuse_color', 'albedo.blue', '', null, undefined])(
    'leaves %s as color or unknown channel data',
    (channelName) => {
      expect(classifyDataChannel(channelName)).toEqual({ isData: false, semantic: null });
      expect(isDataChannel(channelName)).toBe(false);
    },
  );
});
