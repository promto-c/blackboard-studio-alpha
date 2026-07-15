import { useCallback, useRef, useLayoutEffect, type RefObject } from 'react';
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
import type { RendererMaskLayer } from '@blackboard/renderer';
import { getMediaDescriptor, getNodeAssetIds, nodeFlags } from '@/nodes/helpers';
import { renderViewportFrameWithSharedPipeline } from '@/renderer/pipeline';
import {
  createViewportPipelineResources,
  type OwnedViewportPipelineResources,
} from '@/renderer/viewportPipelineResources';
import type { TextTextureEntry } from '@/hooks/viewport/useViewportTextTextures';
import type { TextureCache } from '@/utils/textureCache';
import {
  WIPE_VERTEX_SHADER,
  WIPE_FRAGMENT_SHADER,
  VIEWPORT_TEXTURE_VERTEX_SHADER,
  VIEWPORT_TEXTURE_FRAGMENT_SHADER,
} from './compareShaders';
import { viewportUVToCanvasUV } from './compareUtils';

interface CompareViewSettings {
  isActive: boolean;
  mode: 'wipe' | 'split';
  dividerPosition: number;
  wipe: {
    orientation: 'vertical' | 'horizontal';
    reference: 'canvas' | 'viewport' | 'cursor';
  };
}

interface UseViewportCompareRenderParams {
  gl: THREE.WebGLRenderer | null;
  viewportSize: { width: number; height: number };
  interactiveViewportRect: { x: number; y: number; width: number; height: number };
  compareView: CompareViewSettings;
  viewportNodesA: AnyNode[];
  viewportNodesB: AnyNode[];
  sceneNode: SceneNode | undefined;
  visualFrame: number;
  viewerSettings: ViewerSettings;
  displayView: DisplayViewSelection;
  projectColorManagement: ProjectColorManagement;
  outputDomain: RenderOutputDomain;
  alphaOverlayStyle: { color: [number, number, number]; opacity: number; bgDarken: number };
  hasRenderableNodes: boolean;
  isRenderReady: boolean;
  mediaUpdateTrigger: number;
  slotADisplayOutputRef: RefObject<THREE.WebGLRenderTarget | null>;
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
  zoom: number;
  pan: { x: number; y: number };
}

interface UseViewportCompareRenderResult {
  finalCompBufferRef: RefObject<THREE.WebGLRenderTarget | null>;
}

const isVideoFileNode = (node: AnyNode): boolean => {
  const descriptor = getMediaDescriptor(node.type);
  return !!(descriptor?.isVideoFile?.(node) ?? nodeFlags(node.type).isVideoFile);
};

/** Lazily initialise the reusable composite scene, camera, and quad mesh. */
function ensureCompositeScene(
  ref: RefObject<{
    compositeScene: THREE.Scene | null;
    compositeCamera: THREE.OrthographicCamera | null;
    compositeQuad: THREE.Mesh | null;
  }>,
): { scene: THREE.Scene; camera: THREE.OrthographicCamera; quad: THREE.Mesh } {
  let scene = ref.current.compositeScene;
  let camera = ref.current.compositeCamera;
  let quad = ref.current.compositeQuad;

  if (!scene || !camera || !quad) {
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;
    quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    scene.add(quad);
    ref.current.compositeScene = scene;
    ref.current.compositeCamera = camera;
    ref.current.compositeQuad = quad;
  }

  return { scene, camera, quad };
}

function ensureSplitScene(
  ref: RefObject<{
    splitScene: THREE.Scene | null;
    splitCamera: THREE.OrthographicCamera | null;
    splitQuad: THREE.Mesh | null;
    splitMaterial: THREE.RawShaderMaterial | null;
    splitSceneWidth: number;
    splitSceneHeight: number;
  }>,
  sceneSize: { width: number; height: number },
): {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  quad: THREE.Mesh;
  material: THREE.RawShaderMaterial;
} {
  let scene = ref.current.splitScene;
  let camera = ref.current.splitCamera;
  let quad = ref.current.splitQuad;
  let material = ref.current.splitMaterial;
  const sceneSizeChanged =
    ref.current.splitSceneWidth !== sceneSize.width ||
    ref.current.splitSceneHeight !== sceneSize.height;

  if (!scene) {
    scene = new THREE.Scene();
    ref.current.splitScene = scene;
  }

  if (!camera) {
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;
    ref.current.splitCamera = camera;
  }

  if (!material) {
    material = new THREE.RawShaderMaterial({
      vertexShader: VIEWPORT_TEXTURE_VERTEX_SHADER,
      fragmentShader: VIEWPORT_TEXTURE_FRAGMENT_SHADER,
      uniforms: {
        u_tDiffuse: { value: null },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    ref.current.splitMaterial = material;
  }

  if (!quad || sceneSizeChanged) {
    if (quad) {
      scene.remove(quad);
      quad.geometry.dispose();
    }

    quad = new THREE.Mesh(new THREE.PlaneGeometry(sceneSize.width, sceneSize.height), material);
    scene.add(quad);
    ref.current.splitQuad = quad;
    ref.current.splitSceneWidth = sceneSize.width;
    ref.current.splitSceneHeight = sceneSize.height;
  }

  return { scene, camera, quad, material };
}

function setSplitPaneCamera(
  camera: THREE.OrthographicCamera,
  visualPane: { x: number; y: number; width: number; height: number },
  interactivePane: { x: number; y: number; width: number; height: number },
  zoom: number,
  pan: { x: number; y: number },
) {
  const safeZoom = Math.max(zoom, 0.001);
  const centerX = interactivePane.x + interactivePane.width / 2;
  const centerY = interactivePane.y + interactivePane.height / 2;

  camera.left = (visualPane.x - centerX - pan.x) / safeZoom;
  camera.right = (visualPane.x + visualPane.width - centerX - pan.x) / safeZoom;
  camera.top = (centerY - pan.y - visualPane.y) / safeZoom;
  camera.bottom = (centerY - pan.y - visualPane.y - visualPane.height) / safeZoom;
  camera.updateProjectionMatrix();
}

function getInteractivePanBase(
  viewportSize: { width: number; height: number },
  interactiveRect: { x: number; y: number; width: number; height: number },
) {
  return {
    x: interactiveRect.x + interactiveRect.width / 2 - viewportSize.width / 2,
    y: viewportSize.height / 2 - (interactiveRect.y + interactiveRect.height / 2),
  };
}

function interactiveDividerToViewportUv(
  divider: number,
  orientation: 'vertical' | 'horizontal',
  viewportSize: { width: number; height: number },
  interactiveRect: { x: number; y: number; width: number; height: number },
) {
  if (orientation === 'vertical') {
    return (interactiveRect.x + divider * interactiveRect.width) / viewportSize.width;
  }
  return (interactiveRect.y + divider * interactiveRect.height) / viewportSize.height;
}

export function useViewportCompareRender({
  gl,
  viewportSize,
  interactiveViewportRect,
  compareView,
  viewportNodesA,
  viewportNodesB,
  sceneNode,
  visualFrame,
  viewerSettings,
  displayView,
  projectColorManagement,
  outputDomain,
  alphaOverlayStyle,
  hasRenderableNodes,
  isRenderReady,
  mediaUpdateTrigger,
  slotADisplayOutputRef,
  textureCacheRef,
  textTexturesRef,
  rotoMaskTexturesRef,
  zoom,
  pan,
}: UseViewportCompareRenderParams): UseViewportCompareRenderResult {
  const finalCompBufferRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const slotBResourcesRef = useRef<OwnedViewportPipelineResources | null>(null);
  const compareTargetsRef = useRef<{
    targetB: THREE.WebGLRenderTarget | null;
    textureB: THREE.Texture | null;
    compositeQuad: THREE.Mesh | null;
    compositeScene: THREE.Scene | null;
    compositeCamera: THREE.OrthographicCamera | null;
    splitQuad: THREE.Mesh | null;
    splitScene: THREE.Scene | null;
    splitCamera: THREE.OrthographicCamera | null;
    splitMaterial: THREE.RawShaderMaterial | null;
    splitSceneWidth: number;
    splitSceneHeight: number;
    lastMode: 'wipe' | 'split' | null;
  }>({
    targetB: null,
    textureB: null,
    compositeQuad: null,
    compositeScene: null,
    compositeCamera: null,
    splitQuad: null,
    splitScene: null,
    splitCamera: null,
    splitMaterial: null,
    splitSceneWidth: 0,
    splitSceneHeight: 0,
    lastMode: null,
  });

  const prevRenderInputsRef = useRef<{
    nodes: AnyNode[];
    sceneNode: SceneNode;
    visualFrame: number;
    mediaUpdateTrigger: number;
    viewerSettings: ViewerSettings;
    displayView: DisplayViewSelection;
    projectColorManagement: ProjectColorManagement;
    outputDomain: RenderOutputDomain;
    alphaOverlayStyle: { color: [number, number, number]; opacity: number; bgDarken: number };
  } | null>(null);

  const disposeCompareResources = useCallback(() => {
    slotBResourcesRef.current?.dispose();
    slotBResourcesRef.current = null;

    const targets = compareTargetsRef.current;
    targets.targetB = null;
    targets.textureB = null;

    if (targets.compositeQuad) {
      targets.compositeScene?.remove(targets.compositeQuad);
      (targets.compositeQuad.material as THREE.Material).dispose();
      targets.compositeQuad.geometry.dispose();
      targets.compositeQuad = null;
    }
    targets.compositeScene = null;
    targets.compositeCamera = null;

    if (targets.splitQuad) {
      targets.splitScene?.remove(targets.splitQuad);
      targets.splitQuad.geometry.dispose();
      targets.splitQuad = null;
    }
    targets.splitMaterial?.dispose();
    targets.splitMaterial = null;
    targets.splitScene = null;
    targets.splitCamera = null;
    targets.splitSceneWidth = 0;
    targets.splitSceneHeight = 0;
    targets.lastMode = null;
    prevRenderInputsRef.current = null;
    finalCompBufferRef.current = null;
  }, []);

  // Explicitly release the slot-B pipeline and presentation resources while
  // they are still associated with a live renderer.
  useLayoutEffect(() => () => disposeCompareResources(), [disposeCompareResources]);

  useLayoutEffect(() => {
    if (!compareView.isActive || !gl || !sceneNode || !hasRenderableNodes) {
      disposeCompareResources();
      return;
    }

    // A pending media frame is temporary. Preserve the last completed compare
    // image and its warm GPU pools instead of tearing everything down.
    if (!isRenderReady) return;

    const slotATarget = slotADisplayOutputRef.current;
    const textureA = slotATarget?.texture ?? null;
    if (!textureA) {
      disposeCompareResources();
      return;
    }

    if (slotBResourcesRef.current && slotBResourcesRef.current.renderer !== gl) {
      slotBResourcesRef.current.dispose();
      slotBResourcesRef.current = null;
      compareTargetsRef.current.targetB = null;
      compareTargetsRef.current.textureB = null;
      prevRenderInputsRef.current = null;
    }

    const prev = prevRenderInputsRef.current;
    const inputsChanged =
      !prev ||
      prev.nodes !== viewportNodesB ||
      prev.sceneNode !== sceneNode ||
      prev.visualFrame !== visualFrame ||
      prev.mediaUpdateTrigger !== mediaUpdateTrigger ||
      prev.viewerSettings !== viewerSettings ||
      prev.displayView !== displayView ||
      prev.projectColorManagement !== projectColorManagement ||
      prev.outputDomain !== outputDomain ||
      prev.alphaOverlayStyle !== alphaOverlayStyle ||
      !slotBResourcesRef.current ||
      !compareTargetsRef.current.textureB;

    let textureB = compareTargetsRef.current.textureB;

    if (inputsChanged) {
      const resources =
        slotBResourcesRef.current ??
        (slotBResourcesRef.current = createViewportPipelineResources(gl));

      try {
        const resultB = renderViewportFrameWithSharedPipeline({
          resources,
          nodes: viewportNodesB,
          sceneNode,
          frame: visualFrame,
          viewerSettings,
          displayView,
          projectColorManagement,
          outputDomain,
          alphaOverlayStyle,
          captureDisplayOutput: true,
          presentToCanvas: false,
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
            const rotoNode = viewportNodesB.find(
              (node): node is RotoNode => node.type === NodeType.ROTO && node.id === nodeId,
            );
            if (!rotoNode) return 0;
            const mode = rotoNode.alphaMode;
            return mode === RotoAlphaMode.REPLACE ? 1 : mode === RotoAlphaMode.ADD ? 2 : 0;
          },
        });

        // The shared pipeline now maintains this ownership too; retaining the
        // assignment here makes the hook safe with older/custom adapters.
        resources.renderTargets = resultB.renderTargets;
        compareTargetsRef.current.targetB = resultB.displayOutputTarget;
        compareTargetsRef.current.textureB = resultB.displayOutputTarget?.texture ?? null;
        textureB = compareTargetsRef.current.textureB;

        if (!textureB) return;

        prevRenderInputsRef.current = {
          nodes: viewportNodesB,
          sceneNode,
          visualFrame,
          mediaUpdateTrigger,
          viewerSettings,
          displayView,
          projectColorManagement,
          outputDomain,
          alphaOverlayStyle,
        };
      } catch (error) {
        // Persistent resources remain owned and reusable after a failed frame;
        // teardown on deactivation/unmount still disposes every allocation.
        console.error('Compare render failed:', error);
        return;
      }
    }

    // ── Composite A and B onto the viewport canvas ──────────
    // Always re-composite even if inputs didn't change (e.g., divider moved)

    if (!textureB) return;

    const presentationSize =
      compareView.mode === 'split'
        ? viewportSize
        : { width: sceneNode.width, height: sceneNode.height };
    const currentRendererSize =
      typeof gl.getSize === 'function' ? gl.getSize(new THREE.Vector2()) : null;
    if (
      !currentRendererSize ||
      currentRendererSize.x !== presentationSize.width ||
      currentRendererSize.y !== presentationSize.height
    ) {
      gl.setSize(presentationSize.width, presentationSize.height);
    }

    if (compareView.mode === 'split') {
      const {
        scene: splitScene,
        camera: splitCamera,
        material: splitMaterial,
      } = ensureSplitScene(compareTargetsRef, { width: sceneNode.width, height: sceneNode.height });
      const activeRect = {
        x: Math.round(interactiveViewportRect.x),
        y: Math.round(interactiveViewportRect.y),
        width: Math.round(interactiveViewportRect.width),
        height: Math.round(interactiveViewportRect.height),
      };
      const panBase = getInteractivePanBase(viewportSize, interactiveViewportRect);
      const splitPan = {
        x: pan.x - panBase.x,
        y: pan.y - panBase.y,
      };
      const previousTarget = gl.getRenderTarget();
      const previousScissorTest = gl.getScissorTest();
      const previousViewport = new THREE.Vector4();
      const previousScissor = new THREE.Vector4();
      gl.getViewport(previousViewport);
      gl.getScissor(previousScissor);

      gl.setRenderTarget(null);
      gl.setScissorTest(false);
      gl.clear();
      gl.setScissorTest(true);

      const renderPane = (
        texture: THREE.Texture,
        visualPane: { x: number; y: number; width: number; height: number },
        interactivePane: { x: number; y: number; width: number; height: number },
      ) => {
        if (visualPane.width <= 0 || visualPane.height <= 0) return;
        if (interactivePane.width <= 0 || interactivePane.height <= 0) return;
        const glY = viewportSize.height - visualPane.y - visualPane.height;
        splitMaterial.uniforms.u_tDiffuse.value = texture;
        gl.setViewport(visualPane.x, glY, visualPane.width, visualPane.height);
        gl.setScissor(visualPane.x, glY, visualPane.width, visualPane.height);
        setSplitPaneCamera(splitCamera, visualPane, interactivePane, zoom, splitPan);
        gl.render(splitScene, splitCamera);
      };

      if (compareView.wipe.orientation === 'vertical') {
        const leftWidth = Math.floor(activeRect.width / 2);
        const splitX = activeRect.x + leftWidth;
        const rightWidth = Math.max(0, activeRect.width - leftWidth);
        renderPane(
          textureA,
          { x: 0, y: 0, width: splitX, height: viewportSize.height },
          {
            x: activeRect.x,
            y: activeRect.y,
            width: leftWidth,
            height: activeRect.height,
          },
        );
        renderPane(
          textureB,
          {
            x: splitX,
            y: 0,
            width: Math.max(0, viewportSize.width - splitX),
            height: viewportSize.height,
          },
          {
            x: splitX,
            y: activeRect.y,
            width: rightWidth,
            height: activeRect.height,
          },
        );
      } else {
        const topHeight = Math.floor(activeRect.height / 2);
        const splitY = activeRect.y + topHeight;
        const bottomHeight = Math.max(0, activeRect.height - topHeight);
        renderPane(
          textureA,
          { x: 0, y: 0, width: viewportSize.width, height: splitY },
          {
            x: activeRect.x,
            y: activeRect.y,
            width: activeRect.width,
            height: topHeight,
          },
        );
        renderPane(
          textureB,
          {
            x: 0,
            y: splitY,
            width: viewportSize.width,
            height: Math.max(0, viewportSize.height - splitY),
          },
          {
            x: activeRect.x,
            y: splitY,
            width: activeRect.width,
            height: bottomHeight,
          },
        );
      }

      gl.setViewport(previousViewport);
      gl.setScissor(previousScissor);
      gl.setScissorTest(previousScissorTest);
      gl.setRenderTarget(previousTarget);
      finalCompBufferRef.current = slotATarget;
      compareTargetsRef.current.lastMode = compareView.mode;
      return;
    }

    // Reusable composite scene — created once, never recreated
    const {
      scene: compositeScene,
      camera: compositeCamera,
      quad: compositeQuad,
    } = ensureCompositeScene(compareTargetsRef);

    // Compute the effective divider position in canvas UV space,
    // accounting for the reference mode (canvas vs viewport/cursor).
    const reference = compareView.wipe.reference;
    const effectiveDivider =
      reference === 'canvas' || !sceneNode
        ? compareView.dividerPosition
        : viewportUVToCanvasUV(
            interactiveDividerToViewportUv(
              compareView.dividerPosition,
              compareView.wipe.orientation,
              viewportSize,
              interactiveViewportRect,
            ),
            compareView.wipe.orientation,
            viewportSize,
            sceneNode,
            zoom,
            pan,
          );

    const modeChanged = compareTargetsRef.current.lastMode !== compareView.mode;

    if (modeChanged || !compositeQuad.material) {
      // Shader mode changed or first run — dispose old material, create new one
      if (compositeQuad.material) {
        (compositeQuad.material as THREE.Material).dispose();
      }

      compositeQuad.material = new THREE.ShaderMaterial({
        vertexShader: WIPE_VERTEX_SHADER,
        fragmentShader: WIPE_FRAGMENT_SHADER,
        uniforms: {
          u_tSlotA: { value: textureA },
          u_tSlotB: { value: textureB },
          u_divider: { value: effectiveDivider },
          u_orientation: {
            value: compareView.wipe.orientation === 'vertical' ? 0 : 1,
          },
        },
        depthWrite: false,
        depthTest: false,
      });

      compareTargetsRef.current.lastMode = compareView.mode;
    } else if (compositeQuad.material instanceof THREE.ShaderMaterial) {
      // Same shader — just update uniforms in-place (no allocation)
      const mat = compositeQuad.material;
      mat.uniforms.u_tSlotA.value = textureA;
      mat.uniforms.u_tSlotB.value = textureB;

      mat.uniforms.u_divider.value = effectiveDivider;
      mat.uniforms.u_orientation.value = compareView.wipe.orientation === 'vertical' ? 0 : 1;
    }

    // Render the composite to the visible canvas
    const previousTarget = gl.getRenderTarget();
    gl.setRenderTarget(null);
    gl.render(compositeScene, compositeCamera);

    // Store final pixel reading target
    finalCompBufferRef.current = slotATarget;

    // Restore render target
    gl.setRenderTarget(previousTarget);
  }, [
    compareView.isActive,
    compareView.mode,
    compareView.dividerPosition,
    compareView.wipe.orientation,
    compareView.wipe.reference,
    viewportNodesA,
    viewportNodesB,
    sceneNode,
    visualFrame,
    viewerSettings,
    displayView,
    projectColorManagement,
    outputDomain,
    alphaOverlayStyle,
    hasRenderableNodes,
    isRenderReady,
    mediaUpdateTrigger,
    viewportSize,
    interactiveViewportRect,
    gl,
    slotADisplayOutputRef,
    textureCacheRef,
    textTexturesRef,
    rotoMaskTexturesRef,
    zoom,
    pan,
    disposeCompareResources,
  ]);

  return { finalCompBufferRef };
}
