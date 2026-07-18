import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ComfyNode } from '@blackboard/types';
import { ComfyCropSvgOverlay } from './ComfyCropOverlay';

describe('ComfyCropSvgOverlay', () => {
  it('keeps regions unfilled and labels only the selected region with its size', () => {
    const node = {
      selectedViewportPromptRegionId: 'region-2',
      viewportPromptRegions: [
        {
          id: 'region-1',
          prompt: '',
          rect: { x: 10, y: 20, width: 120, height: 80 },
        },
        {
          id: 'region-2',
          prompt: '',
          rect: { x: 50, y: 60, width: 240, height: 160 },
        },
      ],
    } as ComfyNode;

    const markup = renderToStaticMarkup(
      <svg>
        <ComfyCropSvgOverlay
          node={node}
          frame={0}
          zoom={1}
          pan={{ x: 0, y: 0 }}
          scene={{ width: 640, height: 480 }}
          activeTool="comfy_crop"
          context={{
            viewport: {
              mouseScenePos: null,
              activeViewportTool: 'comfy_crop',
            },
          }}
        />
      </svg>,
    );

    expect(markup.match(/fill="none"/g)).toHaveLength(2);
    expect(markup).toContain('Region 2  240 x 160');
    expect(markup).not.toContain('Region 1');
    expect(markup).not.toContain('Selected Region');
  });

  it('keeps region border width and dash spacing constant on screen across viewport zooms', () => {
    const node = {
      selectedViewportPromptRegionId: 'region-1',
      viewportPromptRegions: [
        {
          id: 'region-1',
          prompt: '',
          rect: { x: 10, y: 20, width: 120, height: 80 },
        },
      ],
    } as ComfyNode;

    const renderAtZoom = (zoom: number) =>
      renderToStaticMarkup(
        <svg>
          <ComfyCropSvgOverlay
            node={node}
            frame={0}
            zoom={zoom}
            pan={{ x: 0, y: 0 }}
            scene={{ width: 640, height: 480 }}
            activeTool="comfy_crop"
            context={{
              viewport: {
                mouseScenePos: null,
                activeViewportTool: 'comfy_crop',
              },
            }}
          />
        </svg>,
      );

    const zoomedOutMarkup = renderAtZoom(0.5);
    const zoomedInMarkup = renderAtZoom(4);

    expect(zoomedOutMarkup).toContain('stroke-width="4"');
    expect(zoomedOutMarkup).toContain('stroke-dasharray="12 8"');
    expect(zoomedInMarkup).toContain('stroke-width="0.5"');
    expect(zoomedInMarkup).toContain('stroke-dasharray="1.5 1"');
  });
});
