// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { NodeType, type SceneNode, type ViewerSettings } from '@blackboard/types';
import { describe, expect, it } from 'vitest';
import { ViewportSvgOverlays, type ViewportSvgOverlaysProps } from './ViewportSvgOverlays';

const sceneNode: SceneNode = {
  id: 'scene',
  type: NodeType.SCENE,
  name: 'Scene',
  enabled: true,
  width: 1920,
  height: 1080,
  bitDepth: 16,
  colorSpace: 'ACEScg',
  startFrame: 0,
  maxFrames: 100,
  fps: 24,
};

const viewerSettings: ViewerSettings = {
  channels: 'RGB',
  alphaOverlay: false,
  gamutWarning: false,
  showOverlays: true,
  gain: 1,
  gamma: 1,
  saturation: 1,
  lastCustomGain: 1,
  lastCustomGamma: 1,
  lastCustomSaturation: 1,
};

const baseProps: ViewportSvgOverlaysProps = {
  sceneNode,
  viewerSettings,
  zoom: 2,
  pan: { x: 0, y: 0 },
  visualFrame: 0,
  activeViewportTool: null,
  overlayContext: {},
  displayWindowRect: null,
  dataWindowRect: {
    x: -100,
    y: -50,
    width: 2120,
    height: 1180,
    nativeWidth: 2120,
    nativeHeight: 1180,
  },
  dataWindowStyle: 'inherited',
  selectedNode: undefined,
  stabilizationMatrix: null,
};

describe('ViewportSvgOverlays data windows', () => {
  it('renders a single unfilled, softer bbox for inherited input data', () => {
    const { container } = render(<ViewportSvgOverlays {...baseProps} />);

    const bbox = container.querySelector('[data-data-window="inherited"]');

    expect(bbox).not.toBeNull();
    expect(bbox?.getAttribute('fill')).toBe('none');
    expect(bbox?.getAttribute('stroke')).toBe('rgb(251 191 36 / 0.32)');
    expect(bbox?.getAttribute('stroke-width')).toBe('1');
    expect(bbox?.querySelector('title')?.textContent).toBe('Data window');
    expect(container.querySelectorAll('[data-data-window]')).toHaveLength(1);
  });

  it('uses only a stronger border color for a node-handled output bbox', () => {
    const { container } = render(<ViewportSvgOverlays {...baseProps} dataWindowStyle="handled" />);

    const bbox = container.querySelector('[data-data-window="handled"]');
    expect(bbox?.getAttribute('fill')).toBe('none');
    expect(bbox?.getAttribute('stroke')).toBe('rgb(251 191 36 / 0.8)');
    expect(bbox?.getAttribute('stroke-width')).toBe('1');
    expect(container.querySelectorAll('[data-data-window]')).toHaveLength(1);
  });

  it('hides the bbox when viewer overlays are disabled', () => {
    const { container } = render(
      <ViewportSvgOverlays
        {...baseProps}
        viewerSettings={{ ...viewerSettings, showOverlays: false }}
      />,
    );

    expect(container.querySelector('[data-data-window]')).toBeNull();
  });
});
