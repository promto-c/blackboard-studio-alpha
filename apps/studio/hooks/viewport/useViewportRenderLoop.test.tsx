// @vitest-environment jsdom
import { createRef } from 'react';
import { renderHook } from '@testing-library/react';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { NodeType, type SceneNode, type ViewerSettings } from '@blackboard/types';
import { useViewportRenderLoop } from './useViewportRenderLoop';

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
  bitDepth: 8,
  colorSpace: 'sRGB',
} as SceneNode;

const viewerSettings = {
  channels: 'RGB',
  alphaOverlay: false,
  alphaMode: 'FILL_BLACK',
  showOverlays: true,
  ocioDisplay: '',
  ocioView: '',
  gain: 1,
  gamma: 1,
  saturation: 1,
  lastCustomGain: 1,
  lastCustomGamma: 1,
  lastCustomSaturation: 1,
} as ViewerSettings;

describe('useViewportRenderLoop', () => {
  it('preserves the completed drawing buffer while a new viewer request is pending', () => {
    const gl = {
      setRenderTarget: vi.fn(),
      clear: vi.fn(),
      domElement: document.createElement('canvas'),
    } as unknown as THREE.WebGLRenderer;
    const finalTarget = {} as THREE.WebGLRenderTarget;
    renderViewportFrameMock.mockReturnValue({
      renderTargets: [],
      finalCompositeTarget: finalTarget,
    });

    const canvasRef = createRef<HTMLCanvasElement>();
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvasRef, 'current', { value: canvas });
    const threeStuff = {
      scene: new THREE.Scene(),
      camera: new THREE.OrthographicCamera(),
      plane: new THREE.PlaneGeometry(2, 2),
      materials: new Map<string, THREE.ShaderMaterial>(),
      renderTargets: [] as THREE.WebGLRenderTarget[],
      utilityTargets: new Map<string, THREE.WebGLRenderTarget>(),
      ocioTextures: new Map<string, THREE.Texture>(),
      quad: new THREE.Mesh(),
    };
    const textureCacheRef = { current: { get: () => undefined } };
    const textTexturesRef = { current: new Map() };
    const paintTexturesRef = { current: new Map() };
    const rotoMaskTexturesRef = { current: new Map() };

    const { result, rerender } = renderHook(
      ({ ready }) =>
        useViewportRenderLoop({
          gl,
          canvasRef,
          rendererSurfaceSize: { width: 800, height: 600 },
          nodes: [sceneNode],
          sceneNode,
          visualFrame: 0,
          viewerSettings,
          alphaOverlayStyle: { color: [0, 0, 0], opacity: 0, bgDarken: 0 },
          hasRenderableNodes: true,
          isRenderReady: ready,
          mediaUpdateTrigger: 0,
          threeStuff,
          textureCacheRef,
          textTexturesRef,
          paintTexturesRef,
          rotoMaskTexturesRef,
          freezeImageWhileEditing: false,
          deferProjectThumbnailCapture: true,
          signalFrameRendered: vi.fn(),
          setProjectThumbnail: vi.fn(),
        }),
      { initialProps: { ready: false } },
    );

    expect(renderViewportFrameMock).not.toHaveBeenCalled();
    expect(gl.clear).not.toHaveBeenCalled();
    expect(result.current.finalCompBufferRef.current).toBeNull();

    rerender({ ready: true });

    expect(renderViewportFrameMock).toHaveBeenCalledOnce();
    expect(result.current.finalCompBufferRef.current).toBe(finalTarget);
  });
});
