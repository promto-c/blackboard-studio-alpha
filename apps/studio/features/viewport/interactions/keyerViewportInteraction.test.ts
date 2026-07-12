import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeType, UniformUIType, type KeyerNode } from '@blackboard/types';
import { colorManagementService } from '@/color-management';
import { KEYER_SAMPLE_TOOL_ID } from '@/nodes/effects/keyer/keyerModel';
import * as sourcePixelData from '@/state/editor/services/sourcePixelData';
import { KeyerViewportInteraction } from './keyerViewportInteraction';
import type { ViewportAdapterContext } from '../viewportAdapterContext';

describe('KeyerViewportInteraction', () => {
  afterEach(() => vi.restoreAllMocks());

  it('samples the hovered scene-linear pixel into color-picking space and updates hue', () => {
    const node: KeyerNode = {
      id: 'keyer-1',
      type: NodeType.KEYER,
      name: 'Keyer',
      enabled: true,
      matteOverlayWhileAdjusting: true,
      uniforms: {
        u_keyColor: {
          label: 'Screen Color',
          ui: UniformUIType.COLOR,
          value: [0, 1, 0],
        },
        u_hueLow: {
          label: 'Hue Low',
          ui: UniformUIType.SLIDER,
          value: 0.2,
          min: 0,
          max: 1,
          step: 0.001,
        },
        u_hueHigh: {
          label: 'Hue High',
          ui: UniformUIType.SLIDER,
          value: 0.4,
          min: 0,
          max: 1,
          step: 0.001,
        },
      },
    };
    const updateNode = vi.fn();
    const snapshot = colorManagementService.getSnapshot();
    vi.spyOn(colorManagementService, 'getSnapshot').mockReturnValue({
      ...snapshot,
      workingColorSpace: 'ACEScg',
      colorPickingColorSpace: 'sRGB',
    });
    vi.spyOn(colorManagementService, 'transformRgb').mockReturnValue([0.1, 0.8, 0.2]);

    const interaction = new KeyerViewportInteraction({
      selectedNode: node,
      activeViewportTool: KEYER_SAMPLE_TOOL_ID,
      zoom: 1,
      pixelInfo: { x: 10, y: 20, color: [0.05, 0.7, 0.1, 1] },
      updateNode,
    } as unknown as ViewportAdapterContext);
    const preventDefault = vi.fn();

    const event = {
      button: 0,
      clientX: 0,
      clientY: 0,
      sceneX: 0,
      sceneY: 0,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      nativeEvent: { preventDefault } as unknown as MouseEvent,
    };

    expect(interaction.handleMouseDown(event)).toBe(true);
    expect(interaction.handleMouseUp(event)).toBe(true);

    expect(preventDefault).toHaveBeenCalled();
    expect(colorManagementService.transformRgb).toHaveBeenCalledWith(
      'ACEScg',
      'sRGB',
      [0.05, 0.7, 0.1],
    );
    const changes = updateNode.mock.calls[0]?.[1] as { uniforms: KeyerNode['uniforms'] };
    expect(changes.uniforms.u_keyColor?.value).toEqual([0.1, 0.8, 0.2]);
    expect(Number(changes.uniforms.u_hueLow?.value)).toBeLessThan(
      Number(changes.uniforms.u_hueHigh?.value),
    );
  });

  it('previews a small dragged area from Source view and restores it on commit', async () => {
    const node = {
      id: 'keyer-1',
      type: NodeType.KEYER,
      name: 'Keyer',
      enabled: true,
      matteOverlayWhileAdjusting: true,
      uniforms: {
        u_keyColor: { label: 'Screen Color', ui: UniformUIType.COLOR, value: [0, 1, 0] },
        u_hueLow: {
          label: 'Hue Low',
          ui: UniformUIType.SLIDER,
          value: 0.2,
          min: 0,
          max: 1,
          step: 0.001,
        },
        u_hueHigh: {
          label: 'Hue High',
          ui: UniformUIType.SLIDER,
          value: 0.4,
          min: 0,
          max: 1,
          step: 0.001,
        },
        u_satLow: {
          label: 'Saturation Low',
          ui: UniformUIType.SLIDER,
          value: 0.2,
          min: 0,
          max: 1,
          step: 0.001,
        },
        u_satHigh: {
          label: 'Saturation High',
          ui: UniformUIType.SLIDER,
          value: 1,
          min: 0,
          max: 1,
          step: 0.001,
        },
        u_lumaLow: {
          label: 'Luminance Low',
          ui: UniformUIType.SLIDER,
          value: 0,
          min: 0,
          max: 1,
          step: 0.001,
        },
        u_lumaHigh: {
          label: 'Luminance High',
          ui: UniformUIType.SLIDER,
          value: 1,
          min: 0,
          max: 1,
          step: 0.001,
        },
        u_viewMode: {
          label: 'View',
          ui: UniformUIType.SEGMENTED,
          value: 4,
          options: [],
        },
      },
    } as KeyerNode;
    const sourceNode = {
      id: 'source-1',
      type: NodeType.MEDIA_SOURCE,
      name: 'Source',
      enabled: true,
    };
    const sceneNode = {
      id: 'scene-1',
      type: NodeType.SCENE,
      name: 'Scene',
      enabled: true,
      width: 100,
      height: 100,
      fps: 24,
    };
    const pixels = new Uint8ClampedArray(4 * 4 * 4);
    for (let offset = 0; offset < pixels.length; offset += 4) {
      pixels.set([20, 190, 40, 255], offset);
    }
    const frameSpy = vi
      .spyOn(sourcePixelData, 'getSourcePixelDataForFrame')
      .mockResolvedValue({ data: pixels, width: 4, height: 4 });
    vi.spyOn(colorManagementService, 'transformRgb').mockReturnValue([0.08, 0.75, 0.16]);
    const updateNode = vi.fn();
    const interaction = new KeyerViewportInteraction({
      selectedNode: node,
      activeViewportTool: KEYER_SAMPLE_TOOL_ID,
      zoom: 1,
      pixelInfo: null,
      updateNode,
      nodes: [sourceNode, node],
      sceneNode,
      projectColorManagement: {},
      visualFrame: 12,
    } as unknown as ViewportAdapterContext);
    const pointer = (sceneX: number, sceneY: number) => ({
      button: 0,
      clientX: 0,
      clientY: 0,
      sceneX,
      sceneY,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      nativeEvent: { preventDefault: vi.fn() } as unknown as MouseEvent,
    });

    interaction.handleMouseDown(pointer(-1, -1));
    interaction.handleMouseMove(pointer(0, 0));
    interaction.handleMouseMove(pointer(0.5, 0.5));

    await vi.waitFor(() => {
      const previewCalls = updateNode.mock.calls.filter((call) => call[2] === false);
      expect(previewCalls.length).toBeGreaterThanOrEqual(2);
      const preview = previewCalls.at(-1)?.[1] as { uniforms: KeyerNode['uniforms'] };
      expect(preview.uniforms.u_viewMode?.value).toBe(2);
      expect(preview.uniforms.u_keyColor?.value).toEqual([0.08, 0.75, 0.16]);
    });

    interaction.handleMouseUp(pointer(1, 1));

    await vi.waitFor(() => {
      const commitCalls = updateNode.mock.calls.filter((call) => call[2] === true);
      expect(commitCalls).toHaveLength(1);
      const commit = commitCalls[0]?.[1] as { uniforms: KeyerNode['uniforms'] };
      expect(commit.uniforms.u_viewMode?.value).toBe(4);
    });
    expect(frameSpy).toHaveBeenCalledTimes(1);
    expect(frameSpy).toHaveBeenCalledWith(expect.anything(), 12, 24, {
      finalColorSpace: 'scene_linear',
    });
  });
});
