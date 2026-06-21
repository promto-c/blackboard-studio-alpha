import { useRef, useLayoutEffect, useEffect, type RefObject } from 'react';
import * as THREE from 'three';
import {
  NodeType,
  RotoAlphaMode,
  type AnyNode,
  type PaintNode,
  type RotoNode,
  type SceneNode,
  type ViewerSettings,
} from '@blackboard/types';
import type { RendererMaskLayer } from '@blackboard/renderer';
import { getMediaDescriptor, getNodeAssetIds, nodeFlags } from '@/nodes/helpers';
import { paintNodeHasVisibleContentAtFrame } from '@/nodes/builtin/paint/paintRaster';
import { getPaintTextureCommittedState } from '@/nodes/builtin/paint/paintTextureKeys';
import { renderViewportFrameWithSharedPipeline } from '@/renderer/pipeline';
import type { TextTextureEntry } from './useViewportTextTextures';
import type { TextureCache } from '@/utils/textureCache';

const THUMBNAIL_CAPTURE_DELAY_MS = 1000;

const canvasToDataUrl = async (canvas: HTMLCanvasElement): Promise<string | null> => {
  if (typeof canvas.toBlob !== 'function') {
    try {
      return canvas.toDataURL('image/jpeg', 0.5);
    } catch {
      return null;
    }
  }

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(typeof reader.result === 'string' ? reader.result : null);
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      },
      'image/jpeg',
      0.5,
    );
  });
};

const isVideoFileNode = (node: AnyNode): boolean => {
  const descriptor = getMediaDescriptor(node.type);
  return !!(descriptor?.isVideoFile?.(node) ?? nodeFlags(node.type).isVideoFile);
};

interface ThreeStuff {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  plane: THREE.PlaneGeometry;
  materials: Map<string, THREE.ShaderMaterial>;
  renderTargets: THREE.WebGLRenderTarget[];
  utilityTargets: Map<string, THREE.WebGLRenderTarget>;
  ocioTextures: Map<string, THREE.Texture>;
  quad: THREE.Mesh | null;
}

interface UseViewportRenderLoopParams {
  gl: THREE.WebGLRenderer | null;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  rendererSurfaceSize: { width: number; height: number };
  nodes: AnyNode[];
  sceneNode: SceneNode | undefined;
  visualFrame: number;
  viewerSettings: ViewerSettings;
  alphaOverlayStyle: { color: [number, number, number]; opacity: number; bgDarken: number };
  hasRenderableNodes: boolean;
  isRenderReady: boolean;
  mediaUpdateTrigger: number;
  threeStuff: ThreeStuff;
  textureCacheRef: RefObject<Pick<TextureCache, 'get'>>;
  textTexturesRef: RefObject<Map<string, TextTextureEntry>>;
  paintTexturesRef: RefObject<
    Map<string, { colorTexture: THREE.Texture; alphaTexture: THREE.Texture; committedKey: string }>
  >;
  rotoMaskTexturesRef: RefObject<
    Map<
      string,
      {
        maskLayers?: RendererMaskLayer[];
      }
    >
  >;
  freezeImageWhileEditing: boolean;
  deferProjectThumbnailCapture: boolean;
  signalFrameRendered: () => void;
  setProjectThumbnail: (url: string | null) => void;
}

interface UseViewportRenderLoopResult {
  /** A ref to the final composite render target (for pixel reading). */
  finalCompBufferRef: RefObject<THREE.WebGLRenderTarget | null>;
}

const arePaintTexturesReadyForFrame = (
  nodes: AnyNode[],
  frame: number,
  sceneNode: SceneNode,
  paintTexturesRef: RefObject<
    Map<string, { colorTexture: THREE.Texture; alphaTexture: THREE.Texture; committedKey: string }>
  >,
): boolean => {
  const paintNodes = nodes.filter((node) => node.type === NodeType.PAINT) as PaintNode[];

  for (const node of paintNodes) {
    const expectedState = getPaintTextureCommittedState({
      node,
      nodes,
      frame,
      width: sceneNode.width,
      height: sceneNode.height,
    });
    if (!expectedState.requiresDynamicCloneSource) {
      continue;
    }
    const entry = paintTexturesRef.current.get(node.id);
    const hasVisibleContent = paintNodeHasVisibleContentAtFrame(node, frame);

    if (hasVisibleContent) {
      if (!entry || entry.committedKey !== expectedState.committedKey) {
        return false;
      }
      continue;
    }

    if (entry) {
      return false;
    }
  }

  return true;
};

/**
 * Manages the GPU render loop: kicks off pipeline rendering via
 * useLayoutEffect and captures project thumbnails.
 *
 * Frame-readiness (`visualFrame`) is managed by the caller — this hook
 * receives the already-resolved visual frame.
 */
export function useViewportRenderLoop({
  gl,
  canvasRef,
  rendererSurfaceSize,
  nodes,
  sceneNode,
  visualFrame,
  viewerSettings,
  alphaOverlayStyle,
  hasRenderableNodes,
  isRenderReady,
  mediaUpdateTrigger,
  threeStuff,
  textureCacheRef,
  textTexturesRef,
  paintTexturesRef,
  rotoMaskTexturesRef,
  freezeImageWhileEditing,
  deferProjectThumbnailCapture,
  signalFrameRendered,
  setProjectThumbnail,
}: UseViewportRenderLoopParams): UseViewportRenderLoopResult {
  const finalCompBufferRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const thumbnailCaptureIdRef = useRef(0);

  // Track previous render inputs so the GPU pipeline can be skipped when the
  // useLayoutEffect fires but nothing render-relevant actually changed.
  const prevRenderInputsRef = useRef<{
    nodes: typeof nodes;
    visualFrame: number;
    viewerSettings: typeof viewerSettings;
    alphaOverlayStyle: typeof alphaOverlayStyle;
    sceneNode: typeof sceneNode;
    mediaUpdateTrigger: number;
    hasRenderableNodes: boolean;
    rendererSurfaceWidth: number;
    rendererSurfaceHeight: number;
  } | null>(null);

  // --- Main GPU render ---
  useLayoutEffect(() => {
    // Keep the last completed drawing buffer visible while the next viewer
    // route or timeline frame is still preparing its resources.
    if (!isRenderReady) {
      return;
    }

    if (!gl || !sceneNode || !threeStuff.quad || !hasRenderableNodes) {
      finalCompBufferRef.current = null;
      prevRenderInputsRef.current = null;
      if (gl && canvasRef.current) {
        gl.setRenderTarget(null);
        gl.clear();
      }
      return;
    }

    // Skip the expensive GPU render if nothing visible changed, including
    // roto edits that only affect hidden alpha output in the current viewer mode.
    const prev = prevRenderInputsRef.current;
    if (
      prev &&
      prev.visualFrame === visualFrame &&
      prev.viewerSettings === viewerSettings &&
      prev.alphaOverlayStyle === alphaOverlayStyle &&
      prev.sceneNode === sceneNode &&
      prev.mediaUpdateTrigger === mediaUpdateTrigger &&
      prev.hasRenderableNodes === hasRenderableNodes &&
      prev.rendererSurfaceWidth === rendererSurfaceSize.width &&
      prev.rendererSurfaceHeight === rendererSurfaceSize.height &&
      (prev.nodes === nodes || freezeImageWhileEditing)
    ) {
      signalFrameRendered();
      return;
    }

    if (!arePaintTexturesReadyForFrame(nodes, visualFrame, sceneNode, paintTexturesRef)) {
      return;
    }

    const result = renderViewportFrameWithSharedPipeline({
      resources: {
        renderer: gl,
        scene: threeStuff.scene,
        camera: threeStuff.camera,
        quad: threeStuff.quad,
        materials: threeStuff.materials,
        renderTargets: threeStuff.renderTargets,
        utilityTargets: threeStuff.utilityTargets,
        ocioTextures: threeStuff.ocioTextures,
      },
      nodes: nodes,
      sceneNode,
      frame: visualFrame,
      viewerSettings,
      alphaOverlayStyle,
      getMediaTexture: (node, frame) => {
        const desc = getMediaDescriptor(node.type);
        const key = desc?.getMediaTextureKey?.(node as AnyNode, frame);
        if (!key) return undefined;

        const entry = textureCacheRef.current.get(key);
        if (entry?.texture) return entry.texture;

        if (isVideoFileNode(node) && Math.round(frame) === Math.round(visualFrame)) {
          const [assetId] = getNodeAssetIds(node);
          return assetId ? textureCacheRef.current.get(assetId)?.texture : undefined;
        }

        return undefined;
      },
      getMediaTextureByKey: (key, assetId, isVideoLike) => {
        const entry = textureCacheRef.current.get(key);
        if (entry?.texture) return entry.texture;

        if (isVideoLike && assetId) {
          return textureCacheRef.current.get(assetId)?.texture;
        }

        return undefined;
      },
      getTextTexture: (node) => textTexturesRef.current.get(node.id),
      getPaintTextures: (nodeId) => {
        const entry = paintTexturesRef.current.get(nodeId);
        return entry
          ? {
              color: entry.colorTexture,
              alpha: entry.alphaTexture,
            }
          : undefined;
      },
      getRotoMaskLayers: (nodeId) => rotoMaskTexturesRef.current.get(nodeId)?.maskLayers,
      getRotoAlphaMode: (nodeId) => {
        const rotoNode = nodes.find(
          (n): n is RotoNode => n.type === NodeType.ROTO && n.id === nodeId,
        );
        if (!rotoNode) return 0;
        const mode = rotoNode.alphaMode;
        return mode === RotoAlphaMode.REPLACE ? 1 : mode === RotoAlphaMode.ADD ? 2 : 0;
      },
    });

    threeStuff.renderTargets = result.renderTargets;
    finalCompBufferRef.current = result.finalCompositeTarget;
    prevRenderInputsRef.current = {
      nodes,
      visualFrame,
      viewerSettings,
      alphaOverlayStyle,
      sceneNode,
      mediaUpdateTrigger,
      hasRenderableNodes,
      rendererSurfaceWidth: rendererSurfaceSize.width,
      rendererSurfaceHeight: rendererSurfaceSize.height,
    };
    signalFrameRendered();
  }, [
    gl,
    nodes,
    mediaUpdateTrigger,
    rendererSurfaceSize.width,
    rendererSurfaceSize.height,
    sceneNode,
    threeStuff,
    viewerSettings,
    alphaOverlayStyle,
    hasRenderableNodes,
    isRenderReady,
    visualFrame,
    freezeImageWhileEditing,
    signalFrameRendered,
    canvasRef,
    paintTexturesRef,
    rotoMaskTexturesRef,
    textTexturesRef,
    textureCacheRef,
  ]);

  // Capture a project thumbnail after the viewport finishes rendering.
  useEffect(() => {
    if (deferProjectThumbnailCapture || !isRenderReady) {
      return;
    }

    const captureId = thumbnailCaptureIdRef.current + 1;
    thumbnailCaptureIdRef.current = captureId;

    const timeoutId = setTimeout(() => {
      if (!gl || !sceneNode || !hasRenderableNodes) {
        if (thumbnailCaptureIdRef.current === captureId) {
          setProjectThumbnail(null);
        }
        return;
      }

      void canvasToDataUrl(gl.domElement).then((thumbnailUrl) => {
        if (thumbnailCaptureIdRef.current !== captureId) {
          return;
        }
        setProjectThumbnail(thumbnailUrl);
      });
    }, THUMBNAIL_CAPTURE_DELAY_MS);

    return () => {
      clearTimeout(timeoutId);
      if (thumbnailCaptureIdRef.current === captureId) {
        thumbnailCaptureIdRef.current += 1;
      }
    };
  }, [
    gl,
    sceneNode,
    setProjectThumbnail,
    hasRenderableNodes,
    visualFrame,
    mediaUpdateTrigger,
    deferProjectThumbnailCapture,
    isRenderReady,
  ]);

  return { finalCompBufferRef };
}
