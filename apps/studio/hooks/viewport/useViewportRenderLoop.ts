import { useRef, useLayoutEffect, useEffect, type RefObject } from 'react';
import * as THREE from 'three';
import {
  NodeType,
  RotoAlphaMode,
  type AnyNode,
  type DisplayViewSelection,
  type ProjectColorManagement,
  type RenderOutputDomain,
  type RotoNode,
  type SceneNode,
  type ViewerSettings,
} from '@blackboard/types';
import type { RendererMaskLayer, RenderQuality, RenderRegion } from '@blackboard/renderer';
import { getMediaDescriptor, getNodeAssetIds, nodeFlags } from '@/nodes/helpers';
import { renderViewportFrameWithSharedPipeline } from '@/renderer/pipeline';
import type { TextTextureEntry } from './useViewportTextTextures';
import type { TextureCache } from '@/utils/textureCache';
import { renderNodesToDataURL } from '@/utils/thumbnailRenderer';

const THUMBNAIL_CAPTURE_DELAY_MS = 1000;

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
  displayView: DisplayViewSelection;
  projectColorManagement: ProjectColorManagement;
  outputDomain: RenderOutputDomain;
  renderQuality: RenderQuality;
  workingArea?: RenderRegion | null;
  alphaOverlayStyle: { color: [number, number, number]; opacity: number; bgDarken: number };
  hasRenderableNodes: boolean;
  isRenderReady: boolean;
  /** Capture the display-referred output for a later presentation pass. */
  captureDisplayOutput?: boolean;
  mediaUpdateTrigger: number;
  threeStuff: ThreeStuff;
  textureCacheRef: RefObject<Pick<TextureCache, 'get'>>;
  textTexturesRef: RefObject<Map<string, TextTextureEntry>>;
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
  reportRenderDuration?: (durationMs: number) => void;
  setProjectThumbnail: (url: string | null) => void;
}

interface UseViewportRenderLoopResult {
  /** A ref to the final composite render target (for pixel reading). */
  finalCompBufferRef: RefObject<THREE.WebGLRenderTarget | null>;
  /** Display-referred output captured for compare-mode compositing. */
  displayOutputBufferRef: RefObject<THREE.WebGLRenderTarget | null>;
}

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
  displayView,
  projectColorManagement,
  outputDomain,
  renderQuality,
  workingArea,
  alphaOverlayStyle,
  hasRenderableNodes,
  isRenderReady,
  captureDisplayOutput = false,
  mediaUpdateTrigger,
  threeStuff,
  textureCacheRef,
  textTexturesRef,
  rotoMaskTexturesRef,
  freezeImageWhileEditing,
  deferProjectThumbnailCapture,
  signalFrameRendered,
  reportRenderDuration,
  setProjectThumbnail,
}: UseViewportRenderLoopParams): UseViewportRenderLoopResult {
  const finalCompBufferRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const displayOutputBufferRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const thumbnailCaptureIdRef = useRef(0);

  // Track previous render inputs so the GPU pipeline can be skipped when the
  // useLayoutEffect fires but nothing render-relevant actually changed.
  const prevRenderInputsRef = useRef<{
    nodes: typeof nodes;
    visualFrame: number;
    viewerSettings: typeof viewerSettings;
    displayView: typeof displayView;
    projectColorManagement: typeof projectColorManagement;
    outputDomain: typeof outputDomain;
    renderQuality: typeof renderQuality;
    alphaOverlayStyle: typeof alphaOverlayStyle;
    sceneNode: typeof sceneNode;
    mediaUpdateTrigger: number;
    hasRenderableNodes: boolean;
    captureDisplayOutput: boolean;
    rendererSurfaceWidth: number;
    rendererSurfaceHeight: number;
    workingArea: RenderRegion | null | undefined;
  } | null>(null);

  // --- Main GPU render ---
  useLayoutEffect(() => {
    const releaseCapturedDisplayOutput = () => {
      if (!displayOutputBufferRef.current) return;
      const capturedTarget = displayOutputBufferRef.current;
      for (const [key, target] of threeStuff.utilityTargets) {
        if (target !== capturedTarget) continue;
        threeStuff.utilityTargets.delete(key);
        target.dispose();
        break;
      }
      displayOutputBufferRef.current = null;
    };

    if (!captureDisplayOutput) {
      releaseCapturedDisplayOutput();
    }

    // Keep the last completed drawing buffer visible while the next viewer
    // route or timeline frame is still preparing its resources.
    if (!isRenderReady) {
      return;
    }

    if (!gl || !sceneNode || !threeStuff.quad || !hasRenderableNodes) {
      finalCompBufferRef.current = null;
      prevRenderInputsRef.current = null;
      releaseCapturedDisplayOutput();
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
      prev.displayView === displayView &&
      prev.projectColorManagement === projectColorManagement &&
      prev.outputDomain === outputDomain &&
      prev.renderQuality === renderQuality &&
      prev.alphaOverlayStyle === alphaOverlayStyle &&
      prev.sceneNode === sceneNode &&
      prev.mediaUpdateTrigger === mediaUpdateTrigger &&
      prev.hasRenderableNodes === hasRenderableNodes &&
      prev.captureDisplayOutput === captureDisplayOutput &&
      prev.rendererSurfaceWidth === rendererSurfaceSize.width &&
      prev.rendererSurfaceHeight === rendererSurfaceSize.height &&
      prev.workingArea === workingArea &&
      (prev.nodes === nodes || freezeImageWhileEditing)
    ) {
      signalFrameRendered();
      return;
    }

    const renderStartedAt = performance.now();
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
      displayView,
      projectColorManagement,
      outputDomain,
      quality: renderQuality,
      workingArea,
      alphaOverlayStyle,
      captureDisplayOutput,
      presentToCanvas: !captureDisplayOutput,
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
    displayOutputBufferRef.current = result.displayOutputTarget;
    prevRenderInputsRef.current = {
      nodes,
      visualFrame,
      viewerSettings,
      displayView,
      projectColorManagement,
      outputDomain,
      renderQuality,
      alphaOverlayStyle,
      sceneNode,
      mediaUpdateTrigger,
      hasRenderableNodes,
      captureDisplayOutput,
      rendererSurfaceWidth: rendererSurfaceSize.width,
      rendererSurfaceHeight: rendererSurfaceSize.height,
      workingArea,
    };
    reportRenderDuration?.(performance.now() - renderStartedAt);
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
    displayView,
    projectColorManagement,
    outputDomain,
    renderQuality,
    workingArea,
    alphaOverlayStyle,
    hasRenderableNodes,
    isRenderReady,
    captureDisplayOutput,
    visualFrame,
    freezeImageWhileEditing,
    signalFrameRendered,
    reportRenderDuration,
    canvasRef,
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

      const thumbnailNodes = nodes.filter((node) => !nodeFlags(node.type).isSceneLike);
      void renderNodesToDataURL(thumbnailNodes, sceneNode, projectColorManagement, visualFrame)
        .then((thumbnailUrl) => {
          if (thumbnailCaptureIdRef.current !== captureId) {
            return;
          }
          setProjectThumbnail(thumbnailUrl);
        })
        .catch((error) => {
          console.error('Project thumbnail generation failed:', error);
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
    nodes,
    projectColorManagement,
    deferProjectThumbnailCapture,
    isRenderReady,
  ]);

  return { finalCompBufferRef, displayOutputBufferRef };
}
