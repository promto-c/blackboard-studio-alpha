import { describe, expect, it } from 'vitest';
import {
  interactiveUVToViewportPixel,
  interactiveUVToViewportUV,
  presentationFrameUVToViewportPixel,
  presentationFrameUVToViewportUV,
  viewportPixelToPresentationFrameUV,
} from './compareUtils';

describe('compare wipe coordinates', () => {
  const viewportSize = { width: 1280, height: 720 };
  const interactiveRect = { x: 160, y: 90, width: 960, height: 540 };

  it('maps an interactive cursor divider to one shared viewport position', () => {
    expect(interactiveUVToViewportPixel(0.25, 'vertical', interactiveRect)).toBe(400);
    expect(interactiveUVToViewportUV(0.25, 'vertical', viewportSize, interactiveRect)).toBe(0.3125);
    expect(interactiveUVToViewportPixel(0.75, 'horizontal', interactiveRect)).toBe(495);
    expect(interactiveUVToViewportUV(0.75, 'horizontal', viewportSize, interactiveRect)).toBe(
      0.6875,
    );
  });

  it('keeps canvas-reference conversion invertible through its presentation frame', () => {
    const frame = { x: 248.125, y: 90, width: 303.75, height: 540 };
    const viewportPixel = 420;
    const canvasUV = viewportPixelToPresentationFrameUV(viewportPixel, 'vertical', frame);

    expect(presentationFrameUVToViewportPixel(canvasUV, 'vertical', frame)).toBeCloseTo(
      viewportPixel,
    );
    expect(presentationFrameUVToViewportUV(canvasUV, 'vertical', viewportSize, frame)).toBeCloseTo(
      viewportPixel / viewportSize.width,
    );
  });
});
