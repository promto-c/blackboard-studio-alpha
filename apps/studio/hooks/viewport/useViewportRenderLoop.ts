import { useRef, useLayoutEffect, useEffect, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { NodeType, type AnyNode, type PaintNode, type SceneNode } from '@blackboard/types';
import { getMediaDescriptor, getNodeAssetIds, nodeFlags } from '@/effects/effectHelpers';
import { paintNodeHasVisibleContentAtFrame } from '@/effects/paint/paintRaster';
import { getPaintTextureCommittedState } from '@/effects/paint/paintTextureKeys';
import { renderViewportFrameWithSharedPipeline } from '@/renderer/pipeline';

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

interface CacheEntry {
  texture?: THREE.Texture;
  video?: HTMLVideoElement;
}

interface ThreeStuff {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  plane: THREE.PlaneGeometry;
  materials: Map<string, THREE.ShaderMaterial>;
  renderTargets: THREE.WebGLRenderTarget[];
  quad: THREE.Mesh | null;
}

interface UseViewportRenderLoopParams {
  gl: THREE.WebGLRenderer | null;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  nodes: AnyNode[];
  sceneNode: SceneNode | undefined;
  visualFrame: number;
  viewerSettings: any;
  alphaOverlayStyle: { color: [number, number, number]; opacity: number; bgDarken: number };
  hasRenderableNodes: boolean;
  mediaUpdateTrigger: number;
  threeStuff: ThreeStuff;
  textureCacheRef: MutableRefObject<Map<string, CacheEntry>>;
  textTexturesRef: MutableRefObject<Map<string, any>>;
  paintTexturesRef: MutableRefObject<Map<string, any>>;
  rotoMaskTexturesRef: MutableRefObject<Map<string, any>>;
  freezeImageWhileEditing: boolean;
  deferProjectThumbnailCapture: boolean;
  signalFrameRendered: () => void;
  setProjectThumbnail: (url: string | null) => void;
}

interface UseViewportRenderLoopResult {
  /** A ref to the final composite render target (for pixel reading). */
  finalCompBufferRef: MutableRefObject<THREE.WebGLRenderTarget | null>;
}

const arePaintTexturesReadyForFrame = (
  nodes: AnyNode[],
  frame: number,
  sceneNode: SceneNode,
  paintTexturesRef: MutableRefObject<Map<string, any>>,
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
  nodes,
  sceneNode,
  visualFrame,
  viewerSettings,
  alphaOverlayStyle,
  hasRenderableNodes,
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
  } | null>(null);

  // --- Main GPU render ---
  useLayoutEffect(() => {
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
      },
      nodes: nodes,
      sceneNode,
      frame: visualFrame,
      viewerSettings,
      alphaOverlayStyle,
      getMediaTexture: (node, frame) => {
        const desc = getMediaDescriptor(node.type);
        const key = desc?.getMediaTextureKey?.(node as any, frame);
        if (!key) return undefined;

        const entry = textureCacheRef.current.get(key);
        if (entry?.texture) return entry.texture;

        const flags = nodeFlags(node.type);
        if (flags.isVideoFile && Math.round(frame) === Math.round(visualFrame)) {
          const [assetId] = getNodeAssetIds(node);
          return assetId ? textureCacheRef.current.get(assetId)?.texture : undefined;
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
      getRotoMaskTexture: (nodeId) => rotoMaskTexturesRef.current.get(nodeId)?.texture,
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
    };
    signalFrameRendered();
  }, [
    gl,
    nodes,
    mediaUpdateTrigger,
    sceneNode,
    threeStuff,
    viewerSettings,
    alphaOverlayStyle,
    hasRenderableNodes,
    visualFrame,
    freezeImageWhileEditing,
    signalFrameRendered,
  ]);

  // Capture a project thumbnail after the viewport finishes rendering.
  useEffect(() => {
    if (deferProjectThumbnailCapture) {
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
  ]);

  return { finalCompBufferRef };
}
