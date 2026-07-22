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
import { calculateComparePaneLayout } from './comparePresentation';

type CompareRenderProps = Parameters<typeof useViewportCompareRender>[0];

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

const activeCompareView: CompareRenderProps['compareView'] = {
  isActive: true,
  sidesSwapped: false,
  mode: 'wipe' as const,
  sizingMode: 'fit' as const,
  dividerPosition: 0.5,
  wipe: {
    orientation: 'vertical' as const,
    reference: 'canvas' as const,
  },
};

const getPaneLayout = (
  viewportSize: CompareRenderProps['viewportSize'],
  interactiveRect: CompareRenderProps['interactiveViewportRect'],
  compareView: CompareRenderProps['compareView'],
) =>
  calculateComparePaneLayout({
    viewportSize,
    interactiveRect,
    mode: compareView.mode,
    orientation: compareView.wipe.orientation,
    sidesSwapped: compareView.sidesSwapped,
  });

const createRenderer = () => {
  const size = new THREE.Vector2(1920, 1080);
  let target: THREE.WebGLRenderTarget | null = null;
  let scissorTest = false;
  return {
    getSize: vi.fn((output: THREE.Vector2) => output.copy(size)),
    setSize: vi.fn((width: number, height: number) => size.set(width, height)),
    getRenderTarget: vi.fn(() => target),
    setRenderTarget: vi.fn((next: THREE.WebGLRenderTarget | null) => {
      target = next;
    }),
    getScissorTest: vi.fn(() => scissorTest),
    setScissorTest: vi.fn((next: boolean) => {
      scissorTest = next;
    }),
    getViewport: vi.fn((output: THREE.Vector4) => output.set(0, 0, size.x, size.y)),
    getScissor: vi.fn((output: THREE.Vector4) => output.set(0, 0, size.x, size.y)),
    setViewport: vi.fn(),
    setScissor: vi.fn(),
    clear: vi.fn(),
    render: vi.fn(),
  } as unknown as THREE.WebGLRenderer;
};

const createTarget = (width = 16, height = 9) => {
  const target = new THREE.WebGLRenderTarget(width, height);
  vi.spyOn(target, 'dispose');
  return target;
};

const createHookProps = (
  gl: THREE.WebGLRenderer,
  slotATarget: THREE.WebGLRenderTarget,
): CompareRenderProps => {
  const viewportSize = { width: 1280, height: 720 };
  const interactiveViewportRect = { x: 0, y: 0, width: 1280, height: 720 };
  return {
    gl,
    viewportSize,
    interactiveViewportRect,
    compareView: activeCompareView,
    paneLayout: getPaneLayout(viewportSize, interactiveViewportRect, activeCompareView),
    viewportInterpolation: 'linear',
    viewportNodesA: [slotANode],
    viewportNodesB: [slotBNode],
    sceneNodeA: sceneNode,
    sceneNodeB: sceneNode,
    visualFrame: 0,
    viewerSettings,
    displayView,
    projectColorManagement: createDefaultProjectColorManagement(),
    outputDomain: { kind: 'color' } as const,
    renderQuality: { mode: 'full' as const, resolutionScale: 1, sampleLimit: 128 },
    alphaOverlayStyle: { color: [0, 0, 0] as [number, number, number], opacity: 0, bgDarken: 0 },
    hasRenderableNodes: true,
    isRenderReady: true,
    freezeImageWhileEditing: false,
    mediaUpdateTrigger: 0,
    slotADisplayOutputRef: { current: slotATarget },
    textureCacheRef: { current: { get: () => undefined } },
    textTexturesRef: { current: new Map() },
    rotoMaskTexturesRef: { current: new Map() },
    zoom: 1,
    pan: { x: 0, y: 0 },
  };
};

describe('useViewportCompareRender', () => {
  const allocatedTargets: THREE.WebGLRenderTarget[] = [];

  beforeEach(() => {
    allocatedTargets.length = 0;
    renderViewportFrameMock.mockReset();
    renderViewportFrameMock.mockImplementation(({ resources, sceneNode: renderSceneNode }) => {
      const renderTargets =
        resources.renderTargets.length > 0
          ? resources.renderTargets
          : [createTarget(), createTarget(), createTarget()];
      renderTargets.forEach((target: THREE.WebGLRenderTarget) => {
        if (!allocatedTargets.includes(target)) allocatedTargets.push(target);
      });

      let displayOutputTarget = resources.utilityTargets.get('__viewer:display-output');
      if (!displayOutputTarget) {
        displayOutputTarget = createTarget(renderSceneNode.width, renderSceneNode.height);
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
      (props: CompareRenderProps) => useViewportCompareRender(props),
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

  it('keeps the completed slot-B image while an alpha-dead Roto edit is active', () => {
    const gl = createRenderer();
    const slotATarget = createTarget();
    const initialProps = createHookProps(gl, slotATarget);
    const { rerender } = renderHook(
      (props: CompareRenderProps) => useViewportCompareRender(props),
      { initialProps },
    );

    const editedNodes = [...initialProps.viewportNodesB];
    const proxyQuality = { mode: 'preview' as const, resolutionScale: 0.5, sampleLimit: 16 };
    rerender({
      ...initialProps,
      viewportNodesB: editedNodes,
      renderQuality: proxyQuality,
      freezeImageWhileEditing: true,
    });
    expect(renderViewportFrameMock).toHaveBeenCalledOnce();

    rerender({
      ...initialProps,
      viewportNodesB: editedNodes,
      renderQuality: proxyQuality,
      freezeImageWhileEditing: false,
    });
    expect(renderViewportFrameMock).toHaveBeenCalledTimes(2);
  });

  it('swaps the visible texture sides without changing the canonical base target', () => {
    const gl = createRenderer();
    const slotATarget = createTarget();
    const initialProps = createHookProps(gl, slotATarget);
    const { result, rerender } = renderHook(
      (props: CompareRenderProps) => useViewportCompareRender(props),
      { initialProps },
    );

    const slotBTexture = allocatedTargets.at(-1)?.texture;
    rerender({
      ...initialProps,
      compareView: { ...activeCompareView, sidesSwapped: true },
    });

    const [compositeScene] = vi.mocked(gl.render).mock.calls.at(-1)!;
    const compositeQuad = compositeScene.children[0] as THREE.Mesh;
    const compositeMaterial = compositeQuad.material as THREE.ShaderMaterial;
    expect(compositeMaterial.uniforms.u_tSlotA.value).toBe(slotBTexture);
    expect(compositeMaterial.uniforms.u_tSlotB.value).toBe(slotATarget.texture);
    expect(result.current.finalCompBufferRef.current?.texture).toBe(slotBTexture);
    expect(slotATarget.dispose).not.toHaveBeenCalled();
  });

  it('anchors a canvas-referenced wipe to the leading displayed side after swapping', () => {
    const gl = createRenderer();
    const slotATarget = createTarget(sceneNode.width, sceneNode.height);
    const portraitScene = {
      ...sceneNode,
      id: 'portrait-scene',
      width: 1080,
      height: 1920,
    } as SceneNode;
    const baseProps = createHookProps(gl, slotATarget);
    const compareView = {
      ...activeCompareView,
      sidesSwapped: true,
      dividerPosition: 0.25,
    };
    const initialProps: CompareRenderProps = {
      ...baseProps,
      compareView,
      paneLayout: getPaneLayout(
        baseProps.viewportSize,
        baseProps.interactiveViewportRect,
        compareView,
      ),
      sceneNodeB: portraitScene,
      viewportNodesB: [portraitScene],
    };

    renderHook((props: CompareRenderProps) => useViewportCompareRender(props), { initialProps });

    const [compositeScene] = vi.mocked(gl.render).mock.calls.at(-1)!;
    const material = (compositeScene.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    expect(material.uniforms.u_divider.value).toBeCloseTo(488.125 / 1280);
  });

  it('renders and presents each slot using its own display-window dimensions', () => {
    const gl = createRenderer();
    const slotATarget = createTarget(sceneNode.width, sceneNode.height);
    const portraitScene = {
      ...sceneNode,
      id: 'portrait-scene',
      width: 1080,
      height: 1920,
    } as SceneNode;
    const initialProps = {
      ...createHookProps(gl, slotATarget),
      sceneNodeB: portraitScene,
      viewportNodesB: [portraitScene],
    };

    const { rerender } = renderHook(
      (props: CompareRenderProps) => useViewportCompareRender(props),
      { initialProps },
    );

    expect(renderViewportFrameMock).toHaveBeenCalledWith(
      expect.objectContaining({ sceneNode: portraitScene }),
    );

    const [compositeScene] = vi.mocked(gl.render).mock.calls.at(-1)!;
    const material = (compositeScene.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    expect(material.uniforms.u_slotAFrameSize.value.toArray()).toEqual([1920, 1080]);
    expect(material.uniforms.u_slotBFrameSize.value.x).toBeCloseTo(607.5);
    expect(material.uniforms.u_slotBFrameSize.value.y).toBe(1080);

    rerender({
      ...initialProps,
      compareView: { ...activeCompareView, sizingMode: 'fill' },
    });

    expect(material.uniforms.u_slotBFrameSize.value.x).toBe(1920);
    expect(material.uniforms.u_slotBFrameSize.value.y).toBeCloseTo(1920 ** 2 / 1080);
  });

  it('uses the viewport interpolation preference for wipe and split sampling', () => {
    const gl = createRenderer();
    const slotATarget = createTarget(sceneNode.width, sceneNode.height);
    const initialProps = {
      ...createHookProps(gl, slotATarget),
      viewportInterpolation: 'nearest' as const,
    };
    const { rerender } = renderHook(
      (props: CompareRenderProps) => useViewportCompareRender(props),
      { initialProps },
    );

    const [wipeScene] = vi.mocked(gl.render).mock.calls.at(-1)!;
    const wipeMaterial = (wipeScene.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    expect(wipeMaterial.uniforms.u_interpolation.value).toBe(1);
    expect(wipeMaterial.uniforms.u_slotATextureSize.value.toArray()).toEqual([1920, 1080]);
    expect(wipeMaterial.uniforms.u_slotBTextureSize.value.toArray()).toEqual([1920, 1080]);
    expect(wipeMaterial.fragmentShader).toContain('floor(contentUv * safeTextureSize)');

    const splitCompareView = { ...activeCompareView, mode: 'split' as const };
    rerender({
      ...initialProps,
      compareView: splitCompareView,
      paneLayout: getPaneLayout(
        initialProps.viewportSize,
        initialProps.interactiveViewportRect,
        splitCompareView,
      ),
    });

    const [splitScene] = vi.mocked(gl.render).mock.calls.at(-1)!;
    const splitMaterial = (splitScene.children[0] as THREE.Mesh)
      .material as THREE.RawShaderMaterial;
    expect(splitMaterial.uniforms.u_interpolation.value).toBe(1);
    expect(splitMaterial.uniforms.u_textureSize.value.toArray()).toEqual([1920, 1080]);
    expect(splitMaterial.fragmentShader).toContain('floor(v_uv * safeTextureSize)');

    rerender({
      ...initialProps,
      viewportInterpolation: 'linear',
      compareView: splitCompareView,
      paneLayout: getPaneLayout(
        initialProps.viewportSize,
        initialProps.interactiveViewportRect,
        splitCompareView,
      ),
    });
    expect(splitMaterial.uniforms.u_interpolation.value).toBe(0);
  });

  it('keeps a cursor-referenced wipe aligned in viewport space for mismatched displays', () => {
    const gl = createRenderer();
    const slotATarget = createTarget(sceneNode.width, sceneNode.height);
    const portraitScene = {
      ...sceneNode,
      id: 'portrait-scene',
      width: 1080,
      height: 1920,
    } as SceneNode;
    const baseProps = createHookProps(gl, slotATarget);
    const interactiveViewportRect = { x: 160, y: 90, width: 960, height: 540 };
    const compareView = {
      ...activeCompareView,
      dividerPosition: 0.25,
      wipe: { ...activeCompareView.wipe, reference: 'cursor' as const },
    };
    const initialProps: CompareRenderProps = {
      ...baseProps,
      interactiveViewportRect,
      compareView,
      paneLayout: getPaneLayout(baseProps.viewportSize, interactiveViewportRect, compareView),
      sceneNodeB: portraitScene,
      viewportNodesB: [portraitScene],
    };

    renderHook((props: CompareRenderProps) => useViewportCompareRender(props), { initialProps });

    const [compositeScene] = vi.mocked(gl.render).mock.calls.at(-1)!;
    const material = (compositeScene.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    expect(material.uniforms.u_divider.value).toBeCloseTo(0.3125);
    expect(vi.mocked(gl.setSize)).toHaveBeenLastCalledWith(1280, 720);
  });

  it('uses independent native geometry for Fit and Fill in split panes', () => {
    const gl = createRenderer();
    const slotATarget = createTarget(sceneNode.width, sceneNode.height);
    const portraitScene = {
      ...sceneNode,
      id: 'portrait-scene',
      width: 1080,
      height: 1920,
    } as SceneNode;
    const baseProps = createHookProps(gl, slotATarget);
    const compareView = { ...activeCompareView, mode: 'split' as const };
    const initialProps = {
      ...baseProps,
      compareView,
      paneLayout: getPaneLayout(
        baseProps.viewportSize,
        baseProps.interactiveViewportRect,
        compareView,
      ),
      sceneNodeB: portraitScene,
      viewportNodesB: [portraitScene],
      zoom: 1 / 3,
    };

    const { rerender } = renderHook(
      (props: CompareRenderProps) => useViewportCompareRender(props),
      { initialProps },
    );

    const [fitScene, fitCamera] = vi.mocked(gl.render).mock.calls.at(-1)!;
    const splitQuad = fitScene.children[0] as THREE.Mesh;
    const camera = fitCamera as THREE.OrthographicCamera;
    expect(splitQuad.scale.toArray()).toEqual([1080, 1920, 1]);
    expect(camera.left).toBeCloseTo(-2560 / 3);
    expect(camera.right).toBeCloseTo(2560 / 3);
    expect(camera.top).toBeCloseTo(960);
    expect(camera.bottom).toBeCloseTo(-960);

    rerender({
      ...initialProps,
      compareView: { ...activeCompareView, mode: 'split', sizingMode: 'fill' },
      zoom: 2 / 3,
    });

    const [, fillCamera] = vi.mocked(gl.render).mock.calls.at(-1)!;
    const filledCamera = fillCamera as THREE.OrthographicCamera;
    expect(filledCamera.left).toBeCloseTo(-540);
    expect(filledCamera.right).toBeCloseTo(540);
    expect(filledCamera.top).toBeCloseTo(607.5);
    expect(filledCamera.bottom).toBeCloseTo(-607.5);

    rerender({
      ...initialProps,
      compareView: { ...activeCompareView, mode: 'split', sizingMode: 'none' },
      zoom: 1,
    });

    const [, nativeCamera] = vi.mocked(gl.render).mock.calls.at(-1)!;
    const oneToOneCamera = nativeCamera as THREE.OrthographicCamera;
    expect(oneToOneCamera.left).toBeCloseTo(-320);
    expect(oneToOneCamera.right).toBeCloseTo(320);
    expect(oneToOneCamera.top).toBeCloseTo(360);
    expect(oneToOneCamera.bottom).toBeCloseTo(-360);
  });

  it('retains warm resources while pending and recreates a clean pool after exit', () => {
    const gl = createRenderer();
    const slotATarget = createTarget();
    const initialProps = createHookProps(gl, slotATarget);
    const { rerender, unmount } = renderHook(
      (props: CompareRenderProps) => useViewportCompareRender(props),
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
    const { unmount } = renderHook((props: CompareRenderProps) => useViewportCompareRender(props), {
      initialProps,
    });

    unmount();

    allocatedTargets.forEach((target) => expect(target.dispose).toHaveBeenCalledOnce());
    expect(slotATarget.dispose).not.toHaveBeenCalled();
  });
});
