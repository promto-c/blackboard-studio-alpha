// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NodeType,
  type DisplayViewSelection,
  type SceneNode,
  type ViewerSettings,
} from '@blackboard/types';
import { createDefaultProjectColorManagement } from '@/color-management';
import { useViewportCompareRender } from './useViewportCompareRender';

const { renderViewportFrameMock } = vi.hoisted(() => ({
  renderViewportFrameMock: vi.fn(),
}));

vi.mock('@/renderer/pipeline', () => ({
  renderViewportFrameWithSharedPipeline: renderViewportFrameMock,
}));

const sceneNode = {
  id: 'scene',
  name: 'Scene',
  type: NodeType.SCENE,
  enabled: true,
  width: 1920,
  height: 1080,
  bitDepth: 16,
  colorSpace: 'sRGB',
  fps: 30,
  maxFrames: 100,
} as SceneNode;
const slotANode = { ...sceneNode, id: 'slot-a', name: 'Slot A' } as SceneNode;
const slotBNode = { ...sceneNode, id: 'slot-b', name: 'Slot B' } as SceneNode;

const viewerSettings = {
  channels: 'RGB',
  alphaOverlay: false,
  showOverlays: true,
  gain: 1,
  gamma: 1,
  saturation: 1,
  lastCustomGain: 1,
  lastCustomGamma: 1,
  lastCustomSaturation: 1,
} as ViewerSettings;

const displayView: DisplayViewSelection = {
  display: 'sRGB - Display',
  view: 'ACES 2.0 - SDR 100 nits (Rec.709)',
};

const activeCompareView = {
  isActive: true,
  mode: 'wipe' as const,
  dividerPosition: 0.5,
  wipe: {
    orientation: 'vertical' as const,
    reference: 'canvas' as const,
  },
};

const createRenderer = () => {
  const size = new THREE.Vector2(1920, 1080);
  let target: THREE.WebGLRenderTarget | null = null;
  return {
    getSize: vi.fn((output: THREE.Vector2) => output.copy(size)),
    setSize: vi.fn((width: number, height: number) => size.set(width, height)),
    getRenderTarget: vi.fn(() => target),
    setRenderTarget: vi.fn((next: THREE.WebGLRenderTarget | null) => {
      target = next;
    }),
    render: vi.fn(),
  } as unknown as THREE.WebGLRenderer;
};

const createTarget = () => {
  const target = new THREE.WebGLRenderTarget(16, 9);
  vi.spyOn(target, 'dispose');
  return target;
};

const createHookProps = (gl: THREE.WebGLRenderer, slotATarget: THREE.WebGLRenderTarget) => ({
  gl,
  viewportSize: { width: 1280, height: 720 },
  interactiveViewportRect: { x: 0, y: 0, width: 1280, height: 720 },
  compareView: activeCompareView,
  viewportNodesA: [slotANode],
  viewportNodesB: [slotBNode],
  sceneNode,
  visualFrame: 0,
  viewerSettings,
  displayView,
  projectColorManagement: createDefaultProjectColorManagement(),
  outputDomain: { kind: 'color' } as const,
  alphaOverlayStyle: { color: [0, 0, 0] as [number, number, number], opacity: 0, bgDarken: 0 },
  hasRenderableNodes: true,
  isRenderReady: true,
  mediaUpdateTrigger: 0,
  slotADisplayOutputRef: { current: slotATarget },
  textureCacheRef: { current: { get: () => undefined } },
  textTexturesRef: { current: new Map() },
  paintTexturesRef: { current: new Map() },
  rotoMaskTexturesRef: { current: new Map() },
  zoom: 1,
  pan: { x: 0, y: 0 },
});

describe('useViewportCompareRender', () => {
  const allocatedTargets: THREE.WebGLRenderTarget[] = [];

  beforeEach(() => {
    allocatedTargets.length = 0;
    renderViewportFrameMock.mockReset();
    renderViewportFrameMock.mockImplementation(({ resources }) => {
      const renderTargets =
        resources.renderTargets.length > 0
          ? resources.renderTargets
          : [createTarget(), createTarget(), createTarget()];
      renderTargets.forEach((target: THREE.WebGLRenderTarget) => {
        if (!allocatedTargets.includes(target)) allocatedTargets.push(target);
      });

      let displayOutputTarget = resources.utilityTargets.get('__viewer:display-output');
      if (!displayOutputTarget) {
        displayOutputTarget = createTarget();
        resources.utilityTargets.set('__viewer:display-output', displayOutputTarget);
        allocatedTargets.push(displayOutputTarget);
      }

      return {
        renderTargets,
        finalCompositeTarget: renderTargets[0],
        displayOutputTarget,
      };
    });
  });

  it('reuses a bounded slot-B target pool while frames change', () => {
    const gl = createRenderer();
    const slotATarget = createTarget();
    const initialProps = createHookProps(gl, slotATarget);
    const { rerender } = renderHook(
      (props: ReturnType<typeof createHookProps>) => useViewportCompareRender(props),
      { initialProps },
    );

    for (let frame = 1; frame <= 50; frame += 1) {
      rerender({ ...initialProps, visualFrame: frame });
    }

    expect(renderViewportFrameMock).toHaveBeenCalledTimes(51);
    expect(allocatedTargets).toHaveLength(4);
    expect(renderViewportFrameMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ captureDisplayOutput: true, presentToCanvas: false }),
    );
    expect(
      renderViewportFrameMock.mock.calls.every(
        ([options]) => options.nodes === initialProps.viewportNodesB,
      ),
    ).toBe(true);
    const [compositeScene] = vi.mocked(gl.render).mock.calls.at(-1)!;
    const compositeQuad = compositeScene.children[0] as THREE.Mesh;
    const compositeMaterial = compositeQuad.material as THREE.ShaderMaterial;
    expect(compositeMaterial.uniforms.u_tSlotA.value).toBe(slotATarget.texture);
    expect(slotATarget.dispose).not.toHaveBeenCalled();
  });

  it('retains warm resources while pending and recreates a clean pool after exit', () => {
    const gl = createRenderer();
    const slotATarget = createTarget();
    const initialProps = createHookProps(gl, slotATarget);
    const { rerender, unmount } = renderHook(
      (props: ReturnType<typeof createHookProps>) => useViewportCompareRender(props),
      { initialProps },
    );

    rerender({ ...initialProps, isRenderReady: false, visualFrame: 1 });
    expect(renderViewportFrameMock).toHaveBeenCalledOnce();
    expect(allocatedTargets).toHaveLength(4);
    allocatedTargets.forEach((target) => expect(target.dispose).not.toHaveBeenCalled());

    rerender({
      ...initialProps,
      compareView: { ...activeCompareView, isActive: false },
    });
    allocatedTargets.forEach((target) => expect(target.dispose).toHaveBeenCalledOnce());
    expect(slotATarget.dispose).not.toHaveBeenCalled();

    rerender(initialProps);
    expect(renderViewportFrameMock).toHaveBeenCalledTimes(2);
    expect(allocatedTargets).toHaveLength(8);

    unmount();
    allocatedTargets.forEach((target) => expect(target.dispose).toHaveBeenCalledOnce());
  });

  it('disposes the current pool when unmounted while compare is active', () => {
    const gl = createRenderer();
    const slotATarget = createTarget();
    const initialProps = createHookProps(gl, slotATarget);
    const { unmount } = renderHook(
      (props: ReturnType<typeof createHookProps>) => useViewportCompareRender(props),
      { initialProps },
    );

    unmount();

    allocatedTargets.forEach((target) => expect(target.dispose).toHaveBeenCalledOnce());
    expect(slotATarget.dispose).not.toHaveBeenCalled();
  });
});
