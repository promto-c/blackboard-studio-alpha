import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnyNode, ProjectColorManagement, SceneNode } from '@blackboard/types';
import {
  renderNodeInputFrameToPngBlob,
  renderNodeInputRegionToPngBlob,
} from '@/utils/nodeInputFrame';
import {
  getComfyRenderedInputName,
  renderComfyConnectedInputToPngBlob,
} from './comfyInputRendering';

vi.mock('@/utils/nodeInputFrame', () => ({
  renderNodeInputFrameToPngBlob: vi.fn(),
  renderNodeInputRegionToPngBlob: vi.fn(),
}));

const rootBlob = new Blob(['root'], { type: 'image/png' });
const regionBlob = new Blob(['region'], { type: 'image/png' });
const baseOptions = {
  nodes: [] as AnyNode[],
  flows: {},
  sourceNodeId: 'source-1',
  sceneNode: { id: 'scene-1', width: 1920, height: 1080 } as SceneNode,
  projectColorManagement: {} as ProjectColorManagement,
  frame: 12,
};

describe('Comfy connected input rendering', () => {
  beforeEach(() => {
    vi.mocked(renderNodeInputFrameToPngBlob).mockReset().mockResolvedValue(rootBlob);
    vi.mocked(renderNodeInputRegionToPngBlob).mockReset().mockResolvedValue(regionBlob);
  });

  it('renders a root input through the graph pipeline as an sRGB PNG', async () => {
    await expect(renderComfyConnectedInputToPngBlob(baseOptions)).resolves.toBe(rootBlob);

    expect(renderNodeInputFrameToPngBlob).toHaveBeenCalledWith({
      ...baseOptions,
      finalColorSpace: 'srgb',
    });
    expect(renderNodeInputRegionToPngBlob).not.toHaveBeenCalled();
  });

  it('marks a rendered input as PNG even when its source was EXR', () => {
    expect(getComfyRenderedInputName('camera.exr')).toBe('camera.exr.render.png');
  });

  it('uses the same sRGB contract for region input rendering', async () => {
    const region = { rect: { x: 10, y: 20, width: 640, height: 512 } };

    await expect(
      renderComfyConnectedInputToPngBlob({
        ...baseOptions,
        region,
        regionInputAlphaMode: 'preserve',
      }),
    ).resolves.toBe(regionBlob);

    expect(renderNodeInputRegionToPngBlob).toHaveBeenCalledWith({
      ...baseOptions,
      finalColorSpace: 'srgb',
      regionRect: region.rect,
      regionInputAlphaMode: 'preserve',
    });
    expect(renderNodeInputFrameToPngBlob).not.toHaveBeenCalled();
  });
});
