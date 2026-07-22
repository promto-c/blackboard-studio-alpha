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
import type { RendererMaskLayer, RenderQuality } from '@blackboard/renderer';
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
import { interactiveUVToViewportUV, presentationFrameUVToViewportUV } from './compareUtils';
import {
  calculateCompareLeadingViewProjection,
  calculateComparePresentationScale,
  calculateCompareViewportFrame,
  type ComparePaneLayout,
} from './comparePresentation';
import type { CompareSizingMode } from '@/state/editor/compareView';

interface CompareViewSettings {
  isActive: boolean;
  sidesSwapped: boolean;
  mode: 'wipe' | 'split';
  sizingMode: CompareSizingMode;
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
  paneLayout: ComparePaneLayout;
  viewportInterpolation: 'nearest' | 'linear';
  viewportNodesA: AnyNode[];
  viewportNodesB: AnyNode[];
  sceneNodeA: SceneNode | undefined;
  sceneNodeB: SceneNode | undefined;
  visualFrame: number;
  viewerSettings: ViewerSettings;
  displayView: DisplayViewSelection;
  projectColorManagement: ProjectColorManagement;
  outputDomain: RenderOutputDomain;
  renderQuality: RenderQuality;
  alphaOverlayStyle: { color: [number, number, number]; opacity: number; bgDarken: number };
  hasRenderableNodes: boolean;
  isRenderReady: boolean;
  bypassNodeIdsB?: ReadonlySet<string>;
  freezeImageWhileEditing: boolean;
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
  }>,
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
        u_textureSize: { value: new THREE.Vector2(1, 1) },
        u_interpolation: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    ref.current.splitMaterial = material;
  }

  if (!quad) {
    quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    scene.add(quad);
    ref.current.splitQuad = quad;
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

export function useViewportCompareRender({
  gl,
  viewportSize,
  interactiveViewportRect,
  compareView,
  paneLayout,
  viewportInterpolation,
  viewportNodesA,
  viewportNodesB,
  sceneNodeA,
  sceneNodeB,
  visualFrame,
  viewerSettings,
  displayView,
  projectColorManagement,
  outputDomain,
  renderQuality,
  alphaOverlayStyle,
  hasRenderableNodes,
  isRenderReady,
  bypassNodeIdsB,
  freezeImageWhileEditing,
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
    renderQuality: RenderQuality;
    alphaOverlayStyle: { color: [number, number, number]; opacity: number; bgDarken: number };
    bypassNodeIds: ReadonlySet<string> | undefined;
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
    targets.lastMode = null;
    prevRenderInputsRef.current = null;
    finalCompBufferRef.current = null;
  }, []);

  // Explicitly release the slot-B pipeline and presentation resources while
  // they are still associated with a live renderer.
  useLayoutEffect(() => () => disposeCompareResources(), [disposeCompareResources]);

  useLayoutEffect(() => {
    if (!compareView.isActive || !gl || !sceneNodeA || !sceneNodeB || !hasRenderableNodes) {
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
      (prev.nodes !== viewportNodesB && !freezeImageWhileEditing) ||
      prev.sceneNode !== sceneNodeB ||
      prev.visualFrame !== visualFrame ||
      prev.mediaUpdateTrigger !== mediaUpdateTrigger ||
      prev.viewerSettings !== viewerSettings ||
      prev.displayView !== displayView ||
      prev.projectColorManagement !== projectColorManagement ||
      prev.outputDomain !== outputDomain ||
      (prev.renderQuality !== renderQuality && !freezeImageWhileEditing) ||
      prev.alphaOverlayStyle !== alphaOverlayStyle ||
      prev.bypassNodeIds !== bypassNodeIdsB ||
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
          sceneNode: sceneNodeB,
          frame: visualFrame,
          viewerSettings,
          displayView,
          projectColorManagement,
          outputDomain,
          quality: renderQuality,
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
          bypassNodeIds: bypassNodeIdsB,
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
          sceneNode: sceneNodeB,
          visualFrame,
          mediaUpdateTrigger,
          viewerSettings,
          displayView,
          projectColorManagement,
          outputDomain,
          renderQuality,
          alphaOverlayStyle,
          bypassNodeIds: bypassNodeIdsB,
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

    const slotBTarget = compareTargetsRef.current.targetB;
    const leadingDisplayTarget =
      (compareView.sidesSwapped ? slotBTarget : slotATarget) ?? slotATarget;
    const slotA = {
      texture: textureA,
      textureSize: { width: slotATarget.width, height: slotATarget.height },
      size: sceneNodeA,
    };
    const slotB = {
      texture: textureB,
      textureSize: {
        width: slotBTarget?.width ?? sceneNodeB.width,
        height: slotBTarget?.height ?? sceneNodeB.height,
      },
      size: sceneNodeB,
    };
    const leadingSlot = compareView.sidesSwapped ? slotB : slotA;
    const trailingSlot = compareView.sidesSwapped ? slotA : slotB;
    const leadingViewProjection = calculateCompareLeadingViewProjection({
      viewportSize,
      layout: paneLayout,
      slotASize: sceneNodeA,
      leadingSize: leadingSlot.size,
      sizingMode: compareView.sizingMode,
      zoom,
      pan,
    });

    const presentationSize = viewportSize;
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
        quad: splitQuad,
        material: splitMaterial,
      } = ensureSplitScene(compareTargetsRef);
      const splitPan = leadingViewProjection.presentationPan;
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

      const leadingInteractivePane = paneLayout.leadingPane;
      const trailingInteractivePane = paneLayout.trailingPane;
      const leadingVisualPane = paneLayout.leadingVisualPane;
      const trailingVisualPane = paneLayout.trailingVisualPane;

      // The editor zoom remains the canonical slot-A pixel scale. Each pane derives its
      // own presentation base scale, then receives the same user zoom multiplier and screen pan.
      const sharedZoomMultiplier = leadingViewProjection.scaleMultiplier;

      const renderPane = (
        slot: {
          texture: THREE.Texture;
          textureSize: { width: number; height: number };
          size: Pick<SceneNode, 'width' | 'height'>;
        },
        visualPane: ComparePaneLayout['leadingVisualPane'],
        interactivePane: ComparePaneLayout['leadingPane'],
      ) => {
        if (visualPane.width <= 0 || visualPane.height <= 0) return;
        if (interactivePane.width <= 0 || interactivePane.height <= 0) return;
        const baseScale = calculateComparePresentationScale(
          interactivePane,
          slot.size,
          compareView.sizingMode,
        );
        const paneZoom = baseScale * sharedZoomMultiplier;
        const glY = viewportSize.height - visualPane.y - visualPane.height;
        splitQuad.scale.set(slot.size.width, slot.size.height, 1);
        splitMaterial.uniforms.u_tDiffuse.value = slot.texture;
        splitMaterial.uniforms.u_textureSize.value.set(
          slot.textureSize.width,
          slot.textureSize.height,
        );
        splitMaterial.uniforms.u_interpolation.value = viewportInterpolation === 'nearest' ? 1 : 0;
        gl.setViewport(visualPane.x, glY, visualPane.width, visualPane.height);
        gl.setScissor(visualPane.x, glY, visualPane.width, visualPane.height);
        setSplitPaneCamera(splitCamera, visualPane, interactivePane, paneZoom, splitPan);
        gl.render(splitScene, splitCamera);
      };

      renderPane(leadingSlot, leadingVisualPane, leadingInteractivePane);
      renderPane(trailingSlot, trailingVisualPane, trailingInteractivePane);

      gl.setViewport(previousViewport);
      gl.setScissor(previousScissor);
      gl.setScissorTest(previousScissorTest);
      gl.setRenderTarget(previousTarget);
      finalCompBufferRef.current = leadingDisplayTarget;
      compareTargetsRef.current.lastMode = compareView.mode;
      return;
    }

    // Reusable composite scene — created once, never recreated
    const {
      scene: compositeScene,
      camera: compositeCamera,
      quad: compositeQuad,
    } = ensureCompositeScene(compareTargetsRef);

    const wipePan = leadingViewProjection.presentationPan;
    const sharedZoomMultiplier = leadingViewProjection.scaleMultiplier;
    const getWipeFrame = (slot: typeof slotA) =>
      calculateCompareViewportFrame(paneLayout.leadingPane, slot.size, compareView.sizingMode, {
        scaleMultiplier: sharedZoomMultiplier,
        pan: wipePan,
      });
    const leadingFrame = leadingViewProjection.frame;
    const trailingFrame = getWipeFrame(trailingSlot);
    // The Wipe shader and overlay both use full-viewport coordinates. A
    // Canvas reference follows the currently displayed leading image.
    const effectiveDivider =
      compareView.wipe.reference === 'canvas'
        ? presentationFrameUVToViewportUV(
            compareView.dividerPosition,
            compareView.wipe.orientation,
            viewportSize,
            leadingFrame,
          )
        : interactiveUVToViewportUV(
            compareView.dividerPosition,
            compareView.wipe.orientation,
            viewportSize,
            interactiveViewportRect,
          );
    const toShaderFrameOrigin = (frame: { x: number; y: number; height: number }) =>
      new THREE.Vector2(frame.x, viewportSize.height - frame.y - frame.height);

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
          u_tSlotA: { value: leadingSlot.texture },
          u_tSlotB: { value: trailingSlot.texture },
          u_paneSize: {
            value: new THREE.Vector2(presentationSize.width, presentationSize.height),
          },
          u_slotATextureSize: {
            value: new THREE.Vector2(leadingSlot.textureSize.width, leadingSlot.textureSize.height),
          },
          u_slotBTextureSize: {
            value: new THREE.Vector2(
              trailingSlot.textureSize.width,
              trailingSlot.textureSize.height,
            ),
          },
          u_slotAFrameOrigin: { value: toShaderFrameOrigin(leadingFrame) },
          u_slotAFrameSize: { value: new THREE.Vector2(leadingFrame.width, leadingFrame.height) },
          u_slotBFrameOrigin: { value: toShaderFrameOrigin(trailingFrame) },
          u_slotBFrameSize: {
            value: new THREE.Vector2(trailingFrame.width, trailingFrame.height),
          },
          u_divider: { value: effectiveDivider },
          u_orientation: {
            value: compareView.wipe.orientation === 'vertical' ? 0 : 1,
          },
          u_interpolation: { value: viewportInterpolation === 'nearest' ? 1 : 0 },
        },
        depthWrite: false,
        depthTest: false,
      });

      compareTargetsRef.current.lastMode = compareView.mode;
    } else if (compositeQuad.material instanceof THREE.ShaderMaterial) {
      // Same shader — just update uniforms in-place (no allocation)
      const mat = compositeQuad.material;
      mat.uniforms.u_tSlotA.value = leadingSlot.texture;
      mat.uniforms.u_tSlotB.value = trailingSlot.texture;
      mat.uniforms.u_paneSize.value.set(presentationSize.width, presentationSize.height);
      mat.uniforms.u_slotATextureSize.value.set(
        leadingSlot.textureSize.width,
        leadingSlot.textureSize.height,
      );
      mat.uniforms.u_slotBTextureSize.value.set(
        trailingSlot.textureSize.width,
        trailingSlot.textureSize.height,
      );
      mat.uniforms.u_slotAFrameOrigin.value.copy(toShaderFrameOrigin(leadingFrame));
      mat.uniforms.u_slotAFrameSize.value.set(leadingFrame.width, leadingFrame.height);
      mat.uniforms.u_slotBFrameOrigin.value.copy(toShaderFrameOrigin(trailingFrame));
      mat.uniforms.u_slotBFrameSize.value.set(trailingFrame.width, trailingFrame.height);

      mat.uniforms.u_divider.value = effectiveDivider;
      mat.uniforms.u_orientation.value = compareView.wipe.orientation === 'vertical' ? 0 : 1;
      mat.uniforms.u_interpolation.value = viewportInterpolation === 'nearest' ? 1 : 0;
    }

    // Render the composite to the visible canvas
    const previousTarget = gl.getRenderTarget();
    gl.setRenderTarget(null);
    gl.render(compositeScene, compositeCamera);

    // Store final pixel reading target
    finalCompBufferRef.current = leadingDisplayTarget;

    // Restore render target
    gl.setRenderTarget(previousTarget);
  }, [
    compareView.isActive,
    compareView.sidesSwapped,
    compareView.mode,
    compareView.sizingMode,
    compareView.dividerPosition,
    compareView.wipe.orientation,
    compareView.wipe.reference,
    viewportNodesA,
    viewportNodesB,
    sceneNodeA,
    sceneNodeB,
    visualFrame,
    viewerSettings,
    displayView,
    projectColorManagement,
    outputDomain,
    renderQuality,
    alphaOverlayStyle,
    hasRenderableNodes,
    isRenderReady,
    bypassNodeIdsB,
    freezeImageWhileEditing,
    mediaUpdateTrigger,
    viewportSize,
    interactiveViewportRect,
    paneLayout,
    viewportInterpolation,
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
