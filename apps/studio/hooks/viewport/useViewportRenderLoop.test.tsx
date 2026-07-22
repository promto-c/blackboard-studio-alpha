// @vitest-environment jsdom
import { createRef } from 'react';
import { renderHook } from '@testing-library/react';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  NodeType,
  type AnyNode,
  type DisplayViewSelection,
  type SceneNode,
  type ViewerSettings,
} from '@blackboard/types';
import { useViewportRenderLoop } from './useViewportRenderLoop';
import { createDefaultProjectColorManagement } from '@/color-management';
import type { ViewportPresentationOptions } from '@/renderer/pipeline';

const { presentViewportTextureMock, renderViewportFrameMock } = vi.hoisted(() => ({
  presentViewportTextureMock: vi.fn(),
  renderViewportFrameMock: vi.fn(),
}));

vi.mock('@/renderer/pipeline', () => ({
  presentViewportTextureToCanvas: presentViewportTextureMock,
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

describe('useViewportRenderLoop', () => {
  it('preserves the completed drawing buffer while a new viewer request is pending', () => {
    const gl = {
      setRenderTarget: vi.fn(),
      clear: vi.fn(),
      domElement: document.createElement('canvas'),
    } as unknown as THREE.WebGLRenderer;
    const finalTarget = {} as THREE.WebGLRenderTarget;
    const displayTarget = {
      dispose: vi.fn(),
    } as unknown as THREE.WebGLRenderTarget;
    const presentationTarget = {
      width: 1920,
      height: 1080,
      texture: new THREE.Texture(),
    } as THREE.WebGLRenderTarget;
    renderViewportFrameMock.mockImplementation(
      ({ captureDisplayOutput, presentation, resources }) => {
        if (captureDisplayOutput) {
          resources.utilityTargets.set('__viewer:display-output', displayTarget);
        } else if (presentation) {
          resources.utilityTargets.set('__viewer:display-output', presentationTarget);
        }
        return {
          renderTargets: [],
          finalCompositeTarget: finalTarget,
          displayOutputTarget: captureDisplayOutput ? displayTarget : null,
        };
      },
    );

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
    const rotoMaskTexturesRef = { current: new Map() };
    const nodes = [sceneNode];
    const rendererSurfaceSize = { width: 800, height: 600 };
    const projectColorManagement = createDefaultProjectColorManagement();
    const outputDomain = { kind: 'color' } as const;
    const renderQuality = { mode: 'full', resolutionScale: 1, sampleLimit: 128 } as const;
    const alphaOverlayStyle = {
      color: [0, 0, 0] as [number, number, number],
      opacity: 0,
      bgDarken: 0,
    };
    const signalFrameRendered = vi.fn();
    const setProjectThumbnail = vi.fn();

    interface HarnessProps {
      ready: boolean;
      captureDisplayOutput: boolean;
      presentation: ViewportPresentationOptions | undefined;
      renderNodes?: AnyNode[];
      quality?:
        | typeof renderQuality
        | { mode: 'preview'; resolutionScale: number; sampleLimit: number };
      freeze?: boolean;
    }

    const { result, rerender } = renderHook(
      ({ ready, captureDisplayOutput, presentation, renderNodes, quality, freeze }: HarnessProps) =>
        useViewportRenderLoop({
          gl,
          canvasRef,
          rendererSurfaceSize,
          nodes: renderNodes ?? nodes,
          sceneNode,
          visualFrame: 0,
          viewerSettings,
          displayView,
          projectColorManagement,
          outputDomain,
          renderQuality: quality ?? renderQuality,
          alphaOverlayStyle,
          hasRenderableNodes: true,
          isRenderReady: ready,
          captureDisplayOutput,
          presentation,
          mediaUpdateTrigger: 0,
          threeStuff,
          textureCacheRef,
          textTexturesRef,
          rotoMaskTexturesRef,
          freezeImageWhileEditing: freeze ?? false,
          deferProjectThumbnailCapture: true,
          signalFrameRendered,
          setProjectThumbnail,
        }),
      {
        initialProps: {
          ready: false,
          captureDisplayOutput: true,
          presentation: undefined as ViewportPresentationOptions | undefined,
        },
      },
    );

    expect(renderViewportFrameMock).not.toHaveBeenCalled();
    expect(gl.clear).not.toHaveBeenCalled();
    expect(result.current.finalCompBufferRef.current).toBeNull();

    rerender({ ready: true, captureDisplayOutput: true, presentation: undefined });

    expect(renderViewportFrameMock).toHaveBeenCalledOnce();
    expect(renderViewportFrameMock).toHaveBeenCalledWith(
      expect.objectContaining({ captureDisplayOutput: true, presentToCanvas: false }),
    );
    expect(result.current.finalCompBufferRef.current).toBe(finalTarget);
    expect(result.current.displayOutputBufferRef.current).toBe(displayTarget);

    const editedNodes = [...nodes];
    const proxyQuality = { mode: 'preview' as const, resolutionScale: 0.5, sampleLimit: 16 };
    rerender({
      ready: true,
      captureDisplayOutput: true,
      presentation: undefined,
      renderNodes: editedNodes,
      quality: proxyQuality,
      freeze: true,
    });
    expect(renderViewportFrameMock).toHaveBeenCalledOnce();

    rerender({
      ready: true,
      captureDisplayOutput: true,
      presentation: undefined,
      renderNodes: editedNodes,
      quality: proxyQuality,
      freeze: false,
    });
    expect(renderViewportFrameMock).toHaveBeenCalledTimes(2);

    rerender({ ready: true, captureDisplayOutput: false, presentation: undefined });

    expect(displayTarget.dispose).toHaveBeenCalledOnce();
    expect(threeStuff.utilityTargets.has('__viewer:display-output')).toBe(false);
    expect(renderViewportFrameMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ captureDisplayOutput: false, presentToCanvas: true }),
    );
    expect(result.current.displayOutputBufferRef.current).toBeNull();

    const presentation: ViewportPresentationOptions = {
      inverseTransform: new THREE.Matrix3(),
      destinationSize: { width: 800, height: 600 },
      interpolation: 'nearest',
    };
    rerender({ ready: true, captureDisplayOutput: false, presentation });

    expect(renderViewportFrameMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ presentation }),
    );

    const movedPresentation: ViewportPresentationOptions = {
      ...presentation,
      inverseTransform: new THREE.Matrix3().set(1, 0, 10, 0, 1, -5, 0, 0, 1),
    };
    const fullRenderCount = renderViewportFrameMock.mock.calls.length;
    rerender({ ready: true, captureDisplayOutput: false, presentation: movedPresentation });

    expect(renderViewportFrameMock).toHaveBeenCalledTimes(fullRenderCount);
    expect(presentViewportTextureMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        texture: presentationTarget.texture,
        sourceSize: { width: 1920, height: 1080 },
        presentation: movedPresentation,
      }),
    );
  });
});
