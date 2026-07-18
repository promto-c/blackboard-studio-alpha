// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ViewportSceneOverlayFrame } from './ViewportSceneOverlayFrame';

describe('ViewportSceneOverlayFrame', () => {
  it('maps native scene overlays into the base presentation frame and clip pane', () => {
    const { container } = render(
      <ViewportSceneOverlayFrame
        sceneSize={{ width: 1080, height: 1920 }}
        frame={{ x: 765, y: 130, width: 270, height: 480, scale: 0.25 }}
        clipRect={{ x: 640, y: 0, width: 640, height: 720 }}
      >
        <svg data-testid="overlay" />
      </ViewportSceneOverlayFrame>,
    );

    const clip = container.querySelector<HTMLElement>('[data-viewport-scene-overlay-clip]');
    const frame = container.querySelector<HTMLElement>('[data-viewport-scene-overlay-frame]');

    expect(clip?.style.left).toBe('640px');
    expect(clip?.style.width).toBe('640px');
    expect(frame?.style.left).toBe('125px');
    expect(frame?.style.top).toBe('130px');
    expect(frame?.style.width).toBe('1080px');
    expect(frame?.style.height).toBe('1920px');
    expect(frame?.style.transform).toBe('scale(0.25)');
  });
});
