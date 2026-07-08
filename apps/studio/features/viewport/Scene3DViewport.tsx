import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type {
  Pan,
  ProjectColorManagement,
  Scene3DItem,
  Scene3DNode,
  Scene3DSettings,
  SceneNode,
} from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { normalizeScene3DSettings } from '@/nodes/builtin/scene_3d/scene3d';
import {
  createScene3DPreviewAssetKey,
  configureScene3DDisplayBackdropTexture,
  createScene3DPreviewRenderer,
} from '@/renderer/scene3dPreviewRenderer';
import {
  applyScene3DBackdropPlaneTransform,
  applyScene3DItemTransform,
  createScene3DCameraOrientation,
  createScene3DBaseColor,
  createScene3DBackdropPlaneGeometry,
  createScene3DEnvironmentLight,
  createScene3DLineBox,
  createScene3DLightColor,
  disposeScene3DObject,
  fitImportedScene3DObjectToScene,
  getImportedScene3DObjectBox,
  getScene3DPositiveIntensity,
  isScene3DItemVisible,
  isScene3DSplatItem,
  parseScene3DColor,
  type Scene3DColorTransform,
  scaleScene3DVector,
} from '@/renderer/scene3dRenderer';
import {
  loadScene3DAssetObject,
  type LoadedScene3DAssetObject,
  type LoadScene3DSplatRuntime,
  type Scene3DSplatRuntimeModule,
} from '@/renderer/scene3dAssetLoader';
import { getAsset } from '@/state/assetStorage';
import { VIEWPORT_BACKGROUND } from '@/utils/colors';
import { colorManagementService, convertColorPickingToSceneLinear } from '@/color-management';
import { ViewportFrameOverlay, type ViewportFrameRect } from './ViewportFrameOverlay';
import type { Scene3DViewportCameraMode } from './ViewportCameraSelector';

interface Scene3DViewportProps {
  sceneNode: SceneNode;
  scene3DNode: Scene3DNode;
  projectColorManagement: ProjectColorManagement;
  selectedItemId?: string | null;
  backdropCanvas: HTMLCanvasElement | null;
  hasBackdropOutput: boolean;
  isActive: boolean;
  viewportZoom: number;
  viewportPan: Pan;
  viewportIsFit: boolean;
  viewportCameraMode: Scene3DViewportCameraMode;
  onViewportCameraModeChange: (mode: Scene3DViewportCameraMode) => void;
}

const createAssetPlaceholder = (
  item: Scene3DItem,
  pixelScale: number,
  isSelected: boolean,
): { group: THREE.Group; marker: THREE.LineSegments } => {
  const size = item.size ?? { x: 120, y: 120, z: 120 };
  const isSplat = isScene3DSplatItem(item);
  const marker = createScene3DLineBox(
    size,
    pixelScale,
    isSelected
      ? ASSET_PLACEHOLDER_COLOR_SELECTED
      : isSplat
        ? SPLAT_PLACEHOLDER_COLOR_DEFAULT
        : MODEL_PLACEHOLDER_COLOR_DEFAULT,
    0.72,
  );
  applyScene3DItemTransform(marker, item, pixelScale);
  const group = new THREE.Group();
  group.add(marker);
  return { group, marker };
};

const BOX_EDGE_COLOR_SELECTED = '#f8fafc';
const BOX_EDGE_COLOR_DEFAULT = '#bae6fd';
const ASSET_PLACEHOLDER_COLOR_SELECTED = '#f8fafc';
const MODEL_PLACEHOLDER_COLOR_DEFAULT = '#9ca3af';
const SPLAT_PLACEHOLDER_COLOR_DEFAULT = '#67e8f9';

interface SceneItemBinding {
  type: 'box' | 'asset';
  object?: THREE.Object3D;
  assetKey?: string;
  colorTransform?: Scene3DColorTransform;
  edges?: THREE.LineSegments;
  assetPlaceholder?: THREE.LineSegments;
  assetPlaceholderColor?: string;
  assetHelper?: THREE.Box3Helper;
}

interface EditorCameraView {
  nodeId: string;
  position: THREE.Vector3;
  target: THREE.Vector3;
}

interface ProjectionViewportView {
  zoom: number;
  pan: Pan;
}

interface Scene3DViewportSnapshot {
  scene3d: Scene3DSettings;
  sceneNode: Pick<SceneNode, 'width' | 'height'>;
  backdropCanvas: HTMLCanvasElement | null;
  hasBackdropOutput: boolean;
  transformColorPickingToSceneLinear: Scene3DColorTransform;
}

const createProjectionViewportView = (zoom: number, pan: Pan): ProjectionViewportView => ({
  zoom,
  pan: { x: pan.x, y: pan.y },
});

const projectionViewsEqual = (
  first: ProjectionViewportView,
  second: ProjectionViewportView,
): boolean =>
  Math.abs(first.zoom - second.zoom) < 0.001 &&
  Math.abs(first.pan.x - second.pan.x) < 0.01 &&
  Math.abs(first.pan.y - second.pan.y) < 0.01;

const createProjectionFrameRect = ({
  viewportWidth,
  viewportHeight,
  outputWidth,
  outputHeight,
  view,
}: {
  viewportWidth: number;
  viewportHeight: number;
  outputWidth: number;
  outputHeight: number;
  view: ProjectionViewportView;
}): ViewportFrameRect => {
  const safeZoom = Math.max(0.001, view.zoom);
  const width = outputWidth * safeZoom;
  const height = outputHeight * safeZoom;
  return {
    left: viewportWidth / 2 - width / 2 + view.pan.x,
    top: viewportHeight / 2 - height / 2 - view.pan.y,
    width,
    height,
    viewportWidth,
    viewportHeight,
  };
};

const frameRectsEqual = (first: ViewportFrameRect | null, second: ViewportFrameRect): boolean => {
  if (!first) return false;
  return (
    Math.abs(first.left - second.left) < 0.01 &&
    Math.abs(first.top - second.top) < 0.01 &&
    Math.abs(first.width - second.width) < 0.01 &&
    Math.abs(first.height - second.height) < 0.01 &&
    Math.abs(first.viewportWidth - second.viewportWidth) < 0.01 &&
    Math.abs(first.viewportHeight - second.viewportHeight) < 0.01
  );
};

function Scene3DViewport({
  sceneNode,
  scene3DNode,
  projectColorManagement,
  selectedItemId,
  backdropCanvas,
  hasBackdropOutput,
  isActive,
  viewportZoom,
  viewportPan,
  viewportIsFit,
  viewportCameraMode,
  onViewportCameraModeChange,
}: Scene3DViewportProps) {
  const projectColorManagementRoles = useMemo(
    () => colorManagementService.resolveProjectColorManagement(projectColorManagement),
    [projectColorManagement],
  );
  const viewportPanX = viewportPan.x;
  const viewportPanY = viewportPan.y;
  const mountRef = useRef<HTMLDivElement>(null);
  const isActiveRef = useRef(isActive);
  const [filmBackRect, setFilmBackRect] = useState<ViewportFrameRect | null>(null);
  const resetViewRef = useRef<() => void>(() => {});
  const selectedItemIdRef = useRef<string | null | undefined>(selectedItemId);
  const editorCameraViewRef = useRef<EditorCameraView | null>(null);
  const viewportCameraModeRef = useRef(viewportCameraMode);
  const externalProjectionViewRef = useRef<ProjectionViewportView>(
    createProjectionViewportView(viewportZoom, viewportPan),
  );
  const projectionViewRef = useRef<ProjectionViewportView>(
    createProjectionViewportView(viewportZoom, viewportPan),
  );
  const viewportIsFitRef = useRef(viewportIsFit);
  const applyProjectionTransformRef = useRef<(() => void) | null>(null);
  const applyViewportCameraModeRef = useRef<(() => void) | null>(null);
  const scene3DNodeIdRef = useRef(scene3DNode.id);
  const sceneContextRef = useRef<{
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    bindings: Map<string, SceneItemBinding>;
  } | null>(null);
  const syncActiveStateRef = useRef<(() => void) | null>(null);
  const scene3d = useMemo(
    () =>
      normalizeScene3DSettings(
        { scene3d: scene3DNode.scene3d },
        {
          width: sceneNode.width,
          height: sceneNode.height,
        },
      ),
    [scene3DNode.scene3d, sceneNode.height, sceneNode.width],
  );
  const transformColorPickingToSceneLinear = useMemo<Scene3DColorTransform>(
    () => (color) => convertColorPickingToSceneLinear(color, projectColorManagementRoles),
    [projectColorManagementRoles],
  );
  const snapshotRef = useRef<Scene3DViewportSnapshot>({
    scene3d,
    sceneNode: { width: sceneNode.width, height: sceneNode.height },
    backdropCanvas,
    hasBackdropOutput,
    transformColorPickingToSceneLinear,
  });
  const rebuildSceneContentsRef = useRef<(() => void) | null>(null);
  const renderFrameRef = useRef<(() => void) | null>(null);
  const onViewportCameraModeChangeRef = useRef(onViewportCameraModeChange);

  snapshotRef.current = {
    scene3d,
    sceneNode: { width: sceneNode.width, height: sceneNode.height },
    backdropCanvas,
    hasBackdropOutput,
    transformColorPickingToSceneLinear,
  };

  useEffect(() => {
    onViewportCameraModeChangeRef.current = onViewportCameraModeChange;
  }, [onViewportCameraModeChange]);

  useEffect(() => {
    selectedItemIdRef.current = selectedItemId;
  }, [selectedItemId]);

  useEffect(() => {
    isActiveRef.current = isActive;
    syncActiveStateRef.current?.();
  }, [isActive]);

  useEffect(() => {
    if (scene3DNodeIdRef.current === scene3DNode.id) return;
    scene3DNodeIdRef.current = scene3DNode.id;
    editorCameraViewRef.current = null;
    const nextProjectionView = createProjectionViewportView(viewportZoom, {
      x: viewportPanX,
      y: viewportPanY,
    });
    externalProjectionViewRef.current = nextProjectionView;
    projectionViewRef.current = createProjectionViewportView(
      nextProjectionView.zoom,
      nextProjectionView.pan,
    );
    applyProjectionTransformRef.current?.();
  }, [scene3DNode.id, viewportPanX, viewportPanY, viewportZoom]);

  useEffect(() => {
    const nextProjectionView = createProjectionViewportView(viewportZoom, {
      x: viewportPanX,
      y: viewportPanY,
    });
    externalProjectionViewRef.current = nextProjectionView;
    projectionViewRef.current = createProjectionViewportView(
      nextProjectionView.zoom,
      nextProjectionView.pan,
    );
    applyProjectionTransformRef.current?.();
  }, [viewportPanX, viewportPanY, viewportZoom]);

  useEffect(() => {
    viewportIsFitRef.current = viewportIsFit;
    applyProjectionTransformRef.current?.();
  }, [viewportIsFit]);

  useEffect(() => {
    viewportCameraModeRef.current = viewportCameraMode;
    applyViewportCameraModeRef.current?.();
  }, [viewportCameraMode]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = createScene3DPreviewRenderer();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const initialBackdropColor = new THREE.Color(VIEWPORT_BACKGROUND);
    renderer.setClearColor(initialBackdropColor, 1);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = initialBackdropColor;
    const contentRoot = new THREE.Group();
    scene.add(contentRoot);
    const bindings = new Map<string, SceneItemBinding>();
    sceneContextRef.current = { scene, renderer, bindings };

    const camera = new THREE.PerspectiveCamera(50, 1, 0.001, 10);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };

    let disposed = false;
    let contentVersion = 0;
    let outputTexture: THREE.CanvasTexture | null = null;
    let splatRuntimePromise: Promise<Scene3DSplatRuntimeModule> | null = null;
    let sparkRenderer: THREE.Object3D | null = null;

    const loadSplatRuntime: LoadScene3DSplatRuntime = () => {
      splatRuntimePromise ??= import('@/renderer/scene3dSplatRuntime');
      return splatRuntimePromise;
    };

    const ensureSplatRenderer = async () => {
      const runtime = await loadSplatRuntime();
      if (sparkRenderer || disposed) return;
      sparkRenderer = runtime.createScene3DSplatRenderer(renderer, () =>
        renderFrameRef.current?.(),
      );
      scene.add(sparkRenderer);
    };

    const getSceneCameraRuntime = () => {
      const { scene3d: currentScene3d } = snapshotRef.current;
      const pixelScale = currentScene3d.world.pixelScale;
      const position = scaleScene3DVector(currentScene3d.camera.position, pixelScale);
      const target = scaleScene3DVector(currentScene3d.camera.target, pixelScale);
      return {
        pixelScale,
        position,
        target,
        orientation: createScene3DCameraOrientation(position, target),
      };
    };

    const applyProjectionViewportTransform = () => {
      const { scene3d: currentScene3d, sceneNode: currentSceneNode } = snapshotRef.current;
      const { pixelScale, position, target } = getSceneCameraRuntime();
      const rect = mount.getBoundingClientRect();
      const viewportWidth = Math.max(1, rect.width);
      const viewportHeight = Math.max(1, rect.height);
      const view = projectionViewRef.current;
      const safeZoom = Math.max(0.001, view.zoom);
      const baseDistance = Math.max(position.distanceTo(target), 0.001);
      const baseSceneZoom =
        viewportHeight > 0 && currentSceneNode.height > 0
          ? viewportHeight / currentSceneNode.height
          : 1;
      const projectionScale = safeZoom / Math.max(0.001, baseSceneZoom);
      const translateX = (2 * view.pan.x) / viewportWidth;
      const translateY = (2 * view.pan.y) / viewportHeight;
      const nextFilmBackRect = createProjectionFrameRect({
        viewportWidth,
        viewportHeight,
        outputWidth: currentSceneNode.width,
        outputHeight: currentSceneNode.height,
        view,
      });

      const sceneSpan =
        Math.max(currentScene3d.bounds.x, currentScene3d.bounds.y, currentScene3d.bounds.z) *
        pixelScale;
      camera.fov = currentScene3d.camera.fov;
      camera.near = Math.max(currentScene3d.camera.near * pixelScale, 0.001);
      camera.far = Math.max(
        currentScene3d.camera.far * pixelScale,
        baseDistance + sceneSpan * 2,
        10,
      );
      camera.updateProjectionMatrix();

      const viewportMatrix = new THREE.Matrix4().set(
        projectionScale,
        0,
        0,
        translateX,
        0,
        projectionScale,
        0,
        translateY,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
      );
      camera.projectionMatrix.premultiply(viewportMatrix);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      const isSceneCameraView = viewportCameraModeRef.current === 'sceneCamera';
      const shouldShowFilmBackRect =
        isSceneCameraView &&
        (!viewportIsFitRef.current ||
          !projectionViewsEqual(view, externalProjectionViewRef.current));
      setFilmBackRect((currentRect) => {
        if (!shouldShowFilmBackRect) return currentRect === null ? currentRect : null;
        return frameRectsEqual(currentRect, nextFilmBackRect) ? currentRect : nextFilmBackRect;
      });
    };
    applyProjectionTransformRef.current = applyProjectionViewportTransform;

    const resetProjectionView = () => {
      projectionViewRef.current = createProjectionViewportView(
        externalProjectionViewRef.current.zoom,
        externalProjectionViewRef.current.pan,
      );
    };

    const setCameraFromScene = () => {
      const { position, target } = getSceneCameraRuntime();
      camera.position.copy(position);
      camera.lookAt(target);
      applyProjectionViewportTransform();
    };

    const saveEditorCameraView = () => {
      if (viewportCameraModeRef.current !== 'perspective') return;
      editorCameraViewRef.current = {
        nodeId: scene3DNodeIdRef.current,
        position: camera.position.clone(),
        target: controls.target.clone(),
      };
    };

    const restoreEditorCameraView = () => {
      const savedView = editorCameraViewRef.current;
      if (!savedView || savedView.nodeId !== scene3DNodeIdRef.current) return false;
      camera.position.copy(savedView.position);
      controls.target.copy(savedView.target);
      camera.lookAt(savedView.target);
      return true;
    };

    const applyViewportCameraMode = () => {
      const { target } = getSceneCameraRuntime();
      const isPerspectiveView = viewportCameraModeRef.current === 'perspective';
      controls.enabled = isPerspectiveView;
      if (isPerspectiveView) {
        if (!restoreEditorCameraView()) {
          setCameraFromScene();
          controls.target.copy(target);
        }
      } else {
        setCameraFromScene();
        controls.target.copy(target);
      }
      controls.update();
      applyProjectionViewportTransform();
    };
    applyViewportCameraModeRef.current = applyViewportCameraMode;

    const promoteToPerspectiveView = () => {
      if (viewportCameraModeRef.current === 'perspective') return;
      viewportCameraModeRef.current = 'perspective';
      onViewportCameraModeChangeRef.current('perspective');
      applyViewportCameraMode();
    };

    const handleCameraInteractionDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.button !== 2) return;
      promoteToPerspectiveView();
    };
    renderer.domElement.addEventListener('pointerdown', handleCameraInteractionDown, {
      capture: true,
    });

    const resetToSceneCamera = () => {
      const { target } = getSceneCameraRuntime();
      resetProjectionView();
      setCameraFromScene();
      controls.target.copy(target);
      controls.update();
      applyProjectionViewportTransform();
      if (viewportCameraModeRef.current === 'perspective') {
        saveEditorCameraView();
      }
    };
    resetViewRef.current = resetToSceneCamera;
    controls.addEventListener('change', saveEditorCameraView);

    const disposeCurrentContent = (retainedObjects = new Set<THREE.Object3D>()) => {
      contentVersion += 1;
      outputTexture?.dispose();
      outputTexture = null;
      bindings.clear();
      [...contentRoot.children].forEach((child) => {
        contentRoot.remove(child);
        if (retainedObjects.has(child)) return;
        disposeScene3DObject(child);
      });
    };

    const rebuildSceneContents = () => {
      if (disposed) return;
      const {
        scene3d: currentScene3d,
        backdropCanvas: currentBackdropCanvas,
        hasBackdropOutput: currentHasBackdropOutput,
        transformColorPickingToSceneLinear: currentColorTransform,
      } = snapshotRef.current;

      const retainedAssets = new Map<string, SceneItemBinding>();
      const retainedObjects = new Set<THREE.Object3D>();
      for (const item of currentScene3d.items) {
        if (item.type !== 'model' && item.type !== 'splat') continue;
        const assetKey = createScene3DPreviewAssetKey(item, currentScene3d);
        const binding = bindings.get(item.id);
        if (
          !assetKey ||
          !binding?.object ||
          binding.assetPlaceholder ||
          binding.assetKey !== assetKey ||
          binding.colorTransform !== currentColorTransform
        ) {
          continue;
        }
        retainedAssets.set(item.id, binding);
        retainedObjects.add(binding.object);
        if (binding.assetHelper) retainedObjects.add(binding.assetHelper);
      }

      disposeCurrentContent(retainedObjects);
      const version = contentVersion;

      const { pixelScale, position, target, orientation } = getSceneCameraRuntime();

      contentRoot.add(createScene3DEnvironmentLight(currentScene3d.world, currentColorTransform));

      const outputPlaneItem = currentScene3d.items.find((item) => item.type === 'output_plane');
      if (currentScene3d.world.showOutputPlane && isScene3DItemVisible(outputPlaneItem)) {
        if (currentBackdropCanvas && currentHasBackdropOutput) {
          outputTexture = configureScene3DDisplayBackdropTexture(
            new THREE.CanvasTexture(currentBackdropCanvas),
          );
        }

        if (outputTexture) {
          const geometry = createScene3DBackdropPlaneGeometry(
            Math.max(currentScene3d.bounds.x * pixelScale, 0.001),
            Math.max(currentScene3d.bounds.y * pixelScale, 0.001),
            'dom-canvas',
          );
          const material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            map: outputTexture,
            toneMapped: false,
          });
          const plane = new THREE.Mesh(geometry, material);
          applyScene3DBackdropPlaneTransform(plane, target, orientation);
          contentRoot.add(plane);
        }

        const planeEdges = createScene3DLineBox(
          { x: currentScene3d.bounds.x, y: currentScene3d.bounds.y, z: 0.1 },
          pixelScale,
          '#67e8f9',
          0.82,
        );
        applyScene3DBackdropPlaneTransform(planeEdges, target, orientation);
        contentRoot.add(planeEdges);
      }

      if (currentScene3d.world.gridEnabled) {
        const grid = new THREE.GridHelper(
          Math.max(currentScene3d.world.gridSize * pixelScale, 0.001),
          currentScene3d.world.gridDivisions,
          0x334155,
          0x1f2937,
        );
        grid.position.y = (-currentScene3d.bounds.y * pixelScale) / 2;
        contentRoot.add(grid);
      }

      if (currentScene3d.world.showAxes) {
        const axes = new THREE.AxesHelper(
          Math.max(currentScene3d.bounds.x, currentScene3d.bounds.y) * pixelScale * 0.18,
        );
        contentRoot.add(axes);
      }

      const sceneCameraItem = currentScene3d.items.find((item) => item.type === 'camera');
      if (isScene3DItemVisible(sceneCameraItem)) {
        const shotCamera = new THREE.PerspectiveCamera(
          currentScene3d.camera.fov,
          Math.max(currentScene3d.bounds.x / currentScene3d.bounds.y, 0.001),
          Math.max(currentScene3d.camera.near * pixelScale, 0.001),
          Math.max(currentScene3d.camera.far * pixelScale, 10),
        );
        shotCamera.position.copy(position);
        shotCamera.quaternion.copy(orientation);
        shotCamera.updateMatrixWorld(true);
        contentRoot.add(new THREE.CameraHelper(shotCamera));

        const cameraBody = new THREE.Mesh(
          new THREE.BoxGeometry(0.24, 0.16, 0.12),
          new THREE.MeshBasicMaterial({
            color: parseScene3DColor(sceneCameraItem?.color, '#e5e7eb'),
          }),
        );
        cameraBody.position.copy(shotCamera.position);
        contentRoot.add(cameraBody);
      }

      for (const item of currentScene3d.items) {
        if (!item.visible || item.type === 'output_plane' || item.type === 'camera') continue;

        if (item.type === 'light') {
          const lightColor = createScene3DLightColor(item, '#fef3c7', currentColorTransform);
          const light = new THREE.DirectionalLight(
            lightColor,
            getScene3DPositiveIntensity(item.intensity, 2),
          );
          applyScene3DItemTransform(light, item, pixelScale);
          light.target.position.copy(target);
          contentRoot.add(light);
          contentRoot.add(light.target);

          const marker = new THREE.Mesh(
            new THREE.SphereGeometry(0.12, 16, 12),
            new THREE.MeshBasicMaterial({ color: lightColor }),
          );
          marker.position.copy(light.position);
          contentRoot.add(marker);
          continue;
        }

        if (item.type === 'box') {
          const size = item.size ?? { x: 100, y: 100, z: 100 };
          const geometry = new THREE.BoxGeometry(
            Math.max(size.x * pixelScale, 0.001),
            Math.max(size.y * pixelScale, 0.001),
            Math.max(size.z * pixelScale, 0.001),
          );
          const material = new THREE.MeshStandardMaterial({
            color: createScene3DBaseColor(item, '#38bdf8', currentColorTransform),
            roughness: 0.42,
            metalness: 0.08,
            transparent: true,
            opacity: 0.82,
          });
          const mesh = new THREE.Mesh(geometry, material);
          applyScene3DItemTransform(mesh, item, pixelScale);
          contentRoot.add(mesh);

          const edges = createScene3DLineBox(
            size,
            pixelScale,
            selectedItemIdRef.current === item.id
              ? BOX_EDGE_COLOR_SELECTED
              : BOX_EDGE_COLOR_DEFAULT,
            0.9,
          );
          applyScene3DItemTransform(edges, item, pixelScale);
          contentRoot.add(edges);
          bindings.set(item.id, { type: 'box', object: mesh, edges });
          continue;
        }

        if (item.type === 'model' || item.type === 'splat') {
          const assetKey = createScene3DPreviewAssetKey(item, currentScene3d);
          const retainedAsset = retainedAssets.get(item.id);
          if (assetKey && retainedAsset?.object) {
            applyScene3DItemTransform(retainedAsset.object, item, pixelScale);
            contentRoot.add(retainedAsset.object);
            if (retainedAsset.assetHelper) {
              retainedAsset.object.updateMatrixWorld(true);
              retainedAsset.assetHelper.box.setFromObject(retainedAsset.object);
              retainedAsset.assetHelper.visible = selectedItemIdRef.current === item.id;
              contentRoot.add(retainedAsset.assetHelper);
            }
            bindings.set(item.id, retainedAsset);
            continue;
          }

          const { group: placeholder, marker: placeholderMarker } = createAssetPlaceholder(
            item,
            pixelScale,
            selectedItemIdRef.current === item.id,
          );
          contentRoot.add(placeholder);

          const assetBinding: SceneItemBinding = {
            type: 'asset',
            object: placeholder,
            assetKey: assetKey ?? undefined,
            colorTransform: currentColorTransform,
            assetPlaceholder: placeholderMarker,
            assetPlaceholderColor: isScene3DSplatItem(item)
              ? SPLAT_PLACEHOLDER_COLOR_DEFAULT
              : MODEL_PLACEHOLDER_COLOR_DEFAULT,
          };
          bindings.set(item.id, assetBinding);

          if (!item.asset?.assetId) continue;

          const isStale = () => disposed || version !== contentVersion;
          void (async () => {
            let loadedAsset: LoadedScene3DAssetObject | null = null;
            try {
              const blob = await getAsset(item.asset.assetId);
              if (!blob || isStale()) return;

              loadedAsset = await loadScene3DAssetObject(
                item,
                blob,
                loadSplatRuntime,
                currentColorTransform,
              );
              if (isStale()) {
                disposeScene3DObject(loadedAsset.object);
                return;
              }

              if (loadedAsset.usesSplatRenderer) {
                await ensureSplatRenderer();
                if (isStale()) {
                  disposeScene3DObject(loadedAsset.object);
                  return;
                }
              }

              const importedObject = loadedAsset.object;
              loadedAsset = null;
              contentRoot.remove(placeholder);
              disposeScene3DObject(placeholder);

              const root = new THREE.Group();
              fitImportedScene3DObjectToScene(importedObject, currentScene3d, pixelScale);
              root.add(importedObject);
              applyScene3DItemTransform(root, item, pixelScale);
              contentRoot.add(root);
              root.updateMatrixWorld(true);
              assetBinding.object = root;
              assetBinding.assetPlaceholder = undefined;

              const box = getImportedScene3DObjectBox(importedObject, true);
              if (!box.isEmpty()) {
                const helper = new THREE.Box3Helper(box, new THREE.Color('#f8fafc'));
                helper.visible = selectedItemIdRef.current === item.id;
                contentRoot.add(helper);
                assetBinding.assetHelper = helper;
              }
            } catch (error) {
              if (loadedAsset) {
                disposeScene3DObject(loadedAsset.object);
              }
              if (isStale()) {
                return;
              }
              console.error(`Failed to load 3D asset ${item.asset?.fileName ?? item.name}`, error);
              const errorMarker = createScene3DLineBox(
                item.size ?? { x: 120, y: 120, z: 120 },
                pixelScale,
                '#fb7185',
                0.9,
              );
              applyScene3DItemTransform(errorMarker, item, pixelScale);
              contentRoot.remove(placeholder);
              disposeScene3DObject(placeholder);
              contentRoot.add(errorMarker);
              assetBinding.object = errorMarker;
              assetBinding.assetPlaceholder = undefined;
            }
          })();
          continue;
        }

        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(0.1, 12, 8),
          new THREE.MeshBasicMaterial({ color: parseScene3DColor(item.color, '#a7f3d0') }),
        );
        applyScene3DItemTransform(marker, item, pixelScale);
        contentRoot.add(marker);
      }

      applyViewportCameraMode();
      renderFrameRef.current?.();
    };
    rebuildSceneContentsRef.current = rebuildSceneContents;

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      applyProjectionViewportTransform();
    };
    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);

    let frameId: number | null = null;
    const renderFrame = () => {
      if (outputTexture) outputTexture.needsUpdate = true;
      controls.update();
      camera.updateMatrixWorld(true);
      scene.updateMatrixWorld(true);
      renderer.render(scene, camera);
    };
    renderFrameRef.current = renderFrame;
    const stopRenderLoop = () => {
      if (frameId === null) return;
      cancelAnimationFrame(frameId);
      frameId = null;
    };
    const renderLoop = () => {
      frameId = null;
      if (!isActiveRef.current || disposed) return;
      renderFrame();
      frameId = requestAnimationFrame(renderLoop);
    };
    const startRenderLoop = () => {
      if (frameId !== null || !isActiveRef.current || disposed) return;
      renderFrame();
      frameId = requestAnimationFrame(renderLoop);
    };
    const syncActiveState = () => {
      if (isActiveRef.current) {
        resize();
        applyViewportCameraMode();
        startRenderLoop();
        return;
      }
      saveEditorCameraView();
      stopRenderLoop();
    };
    syncActiveStateRef.current = syncActiveState;
    syncActiveState();

    return () => {
      disposed = true;
      saveEditorCameraView();
      stopRenderLoop();
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', handleCameraInteractionDown, {
        capture: true,
      });
      controls.removeEventListener('change', saveEditorCameraView);
      controls.dispose();
      disposeCurrentContent();
      if (sparkRenderer) {
        scene.remove(sparkRenderer);
        disposeScene3DObject(sparkRenderer);
      }
      scene.remove(contentRoot);
      disposeScene3DObject(contentRoot);
      renderer.dispose();
      renderer.domElement.remove();
      resetViewRef.current = () => {};
      sceneContextRef.current = null;
      applyProjectionTransformRef.current = null;
      applyViewportCameraModeRef.current = null;
      rebuildSceneContentsRef.current = null;
      renderFrameRef.current = null;
      syncActiveStateRef.current = null;
    };
  }, [scene3DNode.id]);

  useEffect(() => {
    rebuildSceneContentsRef.current?.();
  }, [
    backdropCanvas,
    hasBackdropOutput,
    scene3d,
    sceneNode.height,
    sceneNode.width,
    transformColorPickingToSceneLinear,
  ]);

  useEffect(() => {
    const context = sceneContextRef.current;
    if (!context) return;
    for (const [itemId, binding] of context.bindings) {
      const isSelected = itemId === selectedItemId;
      if (binding.type === 'box' && binding.edges) {
        const color = isSelected ? BOX_EDGE_COLOR_SELECTED : BOX_EDGE_COLOR_DEFAULT;
        (binding.edges.material as THREE.LineBasicMaterial).color.set(color);
      }
      if (binding.type === 'asset') {
        if (binding.assetPlaceholder) {
          const color = isSelected
            ? ASSET_PLACEHOLDER_COLOR_SELECTED
            : (binding.assetPlaceholderColor ?? MODEL_PLACEHOLDER_COLOR_DEFAULT);
          (binding.assetPlaceholder.material as THREE.LineBasicMaterial).color.set(color);
        }
        if (binding.assetHelper) {
          binding.assetHelper.visible = isSelected;
        }
      }
    }
    renderFrameRef.current?.();
  }, [selectedItemId]);

  const showCameraViewGuides = viewportCameraMode === 'sceneCamera';

  return (
    <div
      ref={mountRef}
      className="absolute inset-0 overflow-hidden"
      aria-hidden={!isActive}
      style={{
        backgroundColor: VIEWPORT_BACKGROUND,
        pointerEvents: isActive ? 'auto' : 'none',
        visibility: isActive ? 'visible' : 'hidden',
      }}
    >
      <ViewportFrameOverlay rect={showCameraViewGuides ? filmBackRect : null} />
      {showCameraViewGuides && (
        <div className="pointer-events-none absolute left-4 top-4 z-10 min-w-52 rounded-lg border border-cyan-300/20 bg-gray-950/72 px-3 py-2 font-mono text-[10px] text-cyan-100 shadow-xl backdrop-blur-md">
          <div className="text-cyan-300">Scene Rect</div>
          <div>
            {Math.round(scene3d.bounds.x)} x {Math.round(scene3d.bounds.y)}
          </div>
          <div className="mt-1 text-gray-400">
            Distance {Math.round(scene3d.bounds.z)} | FOV {Math.round(scene3d.camera.fov)} deg
          </div>
        </div>
      )}
      <button
        type="button"
        className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-gray-950/72 text-gray-300 shadow-xl backdrop-blur-md transition-colors hover:bg-white/10 hover:text-white"
        title="Reset 3D View"
        aria-label="Reset 3D View"
        onClick={() => resetViewRef.current()}
      >
        <Icons.Reset className="h-4 w-4" />
      </button>
    </div>
  );
}

export default Scene3DViewport;
