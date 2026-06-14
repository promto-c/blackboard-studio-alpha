import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { USDZLoader } from 'three/examples/jsm/loaders/USDZLoader.js';
import { SparkRenderer, SplatFileType, SplatMesh, getSplatFileType } from '@sparkjsdev/spark';
import type {
  Pan,
  Scene3DAssetFormat,
  Scene3DItem,
  Scene3DNode,
  Scene3DVector3,
  SceneNode,
} from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { normalizeScene3DSettings } from '@/nodes/builtin/scene_3d/scene3d';
import { getAsset } from '@/state/assetStorage';
import { VIEWPORT_BACKGROUND } from '@/utils/colors';
import { ViewportFrameOverlay, type ViewportFrameRect } from './ViewportFrameOverlay';
import type { Scene3DViewportCameraMode } from './ViewportCameraSelector';

interface Scene3DViewportProps {
  sceneNode: SceneNode;
  scene3DNode: Scene3DNode;
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

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

const parseColor = (value: string | undefined, fallback: string) => {
  try {
    return new THREE.Color(value || fallback);
  } catch {
    return new THREE.Color(fallback);
  }
};

const scaleVector = (value: Scene3DVector3, scale: number): THREE.Vector3 =>
  new THREE.Vector3(value.x * scale, value.y * scale, value.z * scale);

const applyItemTransform = (object: THREE.Object3D, item: Scene3DItem, pixelScale: number) => {
  object.position.copy(scaleVector(item.transform.position, pixelScale));
  object.rotation.set(
    toRadians(item.transform.rotation.x),
    toRadians(item.transform.rotation.y),
    toRadians(item.transform.rotation.z),
  );
  object.scale.set(item.transform.scale.x, item.transform.scale.y, item.transform.scale.z);
};

const SPLAT_FILE_TYPE_BY_FORMAT: Partial<Record<Scene3DAssetFormat, SplatFileType>> = {
  ply: SplatFileType.PLY,
  spz: SplatFileType.SPZ,
  splat: SplatFileType.SPLAT,
  ksplat: SplatFileType.KSPLAT,
  sog: SplatFileType.PCSOGSZIP,
  rad: SplatFileType.RAD,
};

const isScene3DSplatItem = (item: Scene3DItem): boolean =>
  item.type === 'splat' || item.asset?.kind === 'splat';

const getSparkSplatFileType = (
  format: Scene3DAssetFormat | undefined,
  fileBytes: Uint8Array,
): SplatFileType | undefined =>
  (format ? SPLAT_FILE_TYPE_BY_FORMAT[format] : undefined) ?? getSplatFileType(fileBytes);

const disposeObject = (object: THREE.Object3D) => {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
    } else if (material) {
      material.dispose();
    }
  });
  const disposable = object as THREE.Object3D & { dispose?: () => void };
  disposable.dispose?.();
};

const createLineBox = (size: Scene3DVector3, pixelScale: number, color: string, opacity = 1) => {
  const geometry = new THREE.BoxGeometry(
    Math.max(size.x * pixelScale, 0.001),
    Math.max(size.y * pixelScale, 0.001),
    Math.max(size.z * pixelScale, 0.001),
  );
  const edges = new THREE.EdgesGeometry(geometry);
  geometry.dispose();
  const material = new THREE.LineBasicMaterial({
    color: parseColor(color, '#22d3ee'),
    transparent: opacity < 1,
    opacity,
  });
  return new THREE.LineSegments(edges, material);
};

const createCameraOrientation = (
  position: THREE.Vector3,
  target: THREE.Vector3,
): THREE.Quaternion => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.copy(position);
  camera.lookAt(target);
  return camera.quaternion.clone();
};

const applyBackdropPlaneTransform = (
  object: THREE.Object3D,
  center: THREE.Vector3,
  cameraOrientation: THREE.Quaternion,
) => {
  object.position.copy(center);
  object.quaternion.copy(cameraOrientation);
};

const itemVisible = (item: Scene3DItem | undefined) => item?.visible !== false;

const createGeometryObject = (
  geometry: THREE.BufferGeometry,
  item: Scene3DItem,
): THREE.Object3D => {
  if (!geometry.getAttribute('normal')) {
    geometry.computeVertexNormals();
  }
  const material = new THREE.MeshStandardMaterial({
    color: parseColor(item.color, '#e5e7eb'),
    roughness: 0.58,
    metalness: 0.04,
    vertexColors: Boolean(geometry.getAttribute('color')),
  });
  return new THREE.Mesh(geometry, material);
};

const prepareLoadedObject = (object: THREE.Object3D, item: Scene3DItem): THREE.Object3D => {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry && !mesh.geometry.getAttribute('normal')) {
      mesh.geometry.computeVertexNormals();
    }
    if (!mesh.material) {
      mesh.material = new THREE.MeshStandardMaterial({
        color: parseColor(item.color, '#e5e7eb'),
        roughness: 0.58,
        metalness: 0.04,
      });
    }
  });
  return object;
};

const loadScene3DMeshAssetObject = async (
  item: Scene3DItem,
  objectUrl: string,
): Promise<THREE.Object3D> => {
  switch (item.asset?.format) {
    case 'glb':
    case 'gltf': {
      const result = await new GLTFLoader().loadAsync(objectUrl);
      return prepareLoadedObject(result.scene, item);
    }
    case 'obj': {
      const result = await new OBJLoader().loadAsync(objectUrl);
      return prepareLoadedObject(result, item);
    }
    case 'usdz': {
      const result = await new USDZLoader().loadAsync(objectUrl);
      return prepareLoadedObject(result, item);
    }
    case 'stl': {
      const geometry = await new STLLoader().loadAsync(objectUrl);
      return createGeometryObject(geometry, item);
    }
    case 'ply': {
      const geometry = await new PLYLoader().loadAsync(objectUrl);
      return createGeometryObject(geometry, item);
    }
    default:
      throw new Error('Unsupported 3D asset format.');
  }
};

const loadScene3DSplatAssetObject = async (item: Scene3DItem, blob: Blob): Promise<SplatMesh> => {
  const fileBytes = new Uint8Array(await blob.arrayBuffer());
  const fileType = getSparkSplatFileType(item.asset?.format, fileBytes);
  const mesh = new SplatMesh({
    fileBytes,
    fileType,
    fileName: item.asset?.fileName,
  });
  await mesh.initialized;
  return mesh;
};

const loadScene3DAssetObject = async (
  item: Scene3DItem,
  blob: Blob,
  objectUrls: string[],
): Promise<THREE.Object3D> => {
  if (isScene3DSplatItem(item)) {
    try {
      return await loadScene3DSplatAssetObject(item, blob);
    } catch (error) {
      if (item.asset?.format !== 'ply') throw error;
      console.warn('Failed to load PLY as a Gaussian splat; falling back to mesh loading.', error);
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  objectUrls.push(objectUrl);
  return loadScene3DMeshAssetObject(item, objectUrl);
};

const getImportedObjectBox = (object: THREE.Object3D, applyWorldTransform = false): THREE.Box3 => {
  const splatObject = object as THREE.Object3D & { getBoundingBox?: () => THREE.Box3 };
  if (typeof splatObject.getBoundingBox === 'function') {
    const box = splatObject.getBoundingBox().clone();
    return applyWorldTransform ? box.applyMatrix4(object.matrixWorld) : box;
  }
  return new THREE.Box3().setFromObject(object);
};

const fitImportedObjectToScene = (
  object: THREE.Object3D,
  scene3d: ReturnType<typeof normalizeScene3DSettings>,
  pixelScale: number,
) => {
  const box = getImportedObjectBox(object);
  if (box.isEmpty()) return;

  const size = box.getSize(new THREE.Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxAxis) || maxAxis <= 0) return;

  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(center);

  const canvasSpan = Math.min(scene3d.bounds.x, scene3d.bounds.y) * pixelScale;
  const depthSpan = scene3d.bounds.z * pixelScale;
  const targetSpan = Math.max(Math.min(canvasSpan * 0.42, depthSpan * 0.9), 1);
  object.scale.multiplyScalar(targetSpan / maxAxis);
};

const createAssetPlaceholder = (
  item: Scene3DItem,
  pixelScale: number,
  isSelected: boolean,
): { group: THREE.Group; marker: THREE.LineSegments } => {
  const size = item.size ?? { x: 120, y: 120, z: 120 };
  const isSplat = isScene3DSplatItem(item);
  const marker = createLineBox(
    size,
    pixelScale,
    isSelected
      ? ASSET_PLACEHOLDER_COLOR_SELECTED
      : isSplat
        ? SPLAT_PLACEHOLDER_COLOR_DEFAULT
        : MODEL_PLACEHOLDER_COLOR_DEFAULT,
    0.72,
  );
  applyItemTransform(marker, item, pixelScale);
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

    const pixelScale = scene3d.world.pixelScale;
    const renderer = new THREE.WebGLRenderer({
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const initialBackdropColor = new THREE.Color(VIEWPORT_BACKGROUND);
    renderer.setClearColor(initialBackdropColor, 1);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = initialBackdropColor;
    const sparkRenderer = new SparkRenderer({ renderer });
    scene.add(sparkRenderer);
    const objectUrls: string[] = [];
    let disposed = false;
    const bindings = new Map<string, SceneItemBinding>();
    sceneContextRef.current = { scene, renderer, bindings };

    const sceneCameraPosition = scaleVector(scene3d.camera.position, pixelScale);
    const target = scaleVector(scene3d.camera.target, pixelScale);
    const sceneCameraOrientation = createCameraOrientation(sceneCameraPosition, target);
    const camera = new THREE.PerspectiveCamera(
      scene3d.camera.fov,
      1,
      Math.max(scene3d.camera.near * pixelScale, 0.001),
      Math.max(scene3d.camera.far * pixelScale, 10),
    );

    const applyProjectionViewportTransform = () => {
      const rect = mount.getBoundingClientRect();
      const viewportWidth = Math.max(1, rect.width);
      const viewportHeight = Math.max(1, rect.height);
      const view = projectionViewRef.current;
      const safeZoom = Math.max(0.001, view.zoom);
      const baseDistance = Math.max(sceneCameraPosition.distanceTo(target), 0.001);
      const baseSceneZoom =
        viewportHeight > 0 && sceneNode.height > 0 ? viewportHeight / sceneNode.height : 1;
      const projectionScale = safeZoom / Math.max(0.001, baseSceneZoom);
      const translateX = (2 * view.pan.x) / viewportWidth;
      const translateY = (2 * view.pan.y) / viewportHeight;
      const nextFilmBackRect = createProjectionFrameRect({
        viewportWidth,
        viewportHeight,
        outputWidth: sceneNode.width,
        outputHeight: sceneNode.height,
        view,
      });

      const sceneSpan = Math.max(scene3d.bounds.x, scene3d.bounds.y, scene3d.bounds.z) * pixelScale;
      camera.far = Math.max(scene3d.camera.far * pixelScale, baseDistance + sceneSpan * 2, 10);
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
      camera.position.copy(sceneCameraPosition);
      camera.lookAt(target);
      applyProjectionViewportTransform();
    };

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };

    const saveEditorCameraView = () => {
      if (viewportCameraModeRef.current !== 'perspective') return;
      editorCameraViewRef.current = {
        nodeId: scene3DNode.id,
        position: camera.position.clone(),
        target: controls.target.clone(),
      };
    };

    const restoreEditorCameraView = () => {
      const savedView = editorCameraViewRef.current;
      if (!savedView || savedView.nodeId !== scene3DNode.id) return false;
      camera.position.copy(savedView.position);
      controls.target.copy(savedView.target);
      camera.lookAt(savedView.target);
      return true;
    };

    const applyViewportCameraMode = () => {
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
      onViewportCameraModeChange('perspective');
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

    applyViewportCameraMode();
    controls.addEventListener('change', saveEditorCameraView);

    const ambient = new THREE.HemisphereLight(0xffffff, 0x1f2937, 1.2);
    scene.add(ambient);

    const outputPlaneItem = scene3d.items.find((item) => item.type === 'output_plane');
    let outputTexture: THREE.CanvasTexture | null = null;
    if (scene3d.world.showOutputPlane && itemVisible(outputPlaneItem)) {
      if (backdropCanvas && hasBackdropOutput) {
        outputTexture = new THREE.CanvasTexture(backdropCanvas);
        outputTexture.colorSpace = THREE.SRGBColorSpace;
        outputTexture.minFilter = THREE.LinearFilter;
        outputTexture.magFilter = THREE.LinearFilter;
      }

      if (outputTexture) {
        const geometry = new THREE.PlaneGeometry(
          Math.max(scene3d.bounds.x * pixelScale, 0.001),
          Math.max(scene3d.bounds.y * pixelScale, 0.001),
        );
        const material = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          map: outputTexture,
          side: THREE.DoubleSide,
        });
        const plane = new THREE.Mesh(geometry, material);
        applyBackdropPlaneTransform(plane, target, sceneCameraOrientation);
        scene.add(plane);
      }

      const planeEdges = createLineBox(
        { x: scene3d.bounds.x, y: scene3d.bounds.y, z: 0.1 },
        pixelScale,
        '#67e8f9',
        0.82,
      );
      applyBackdropPlaneTransform(planeEdges, target, sceneCameraOrientation);
      scene.add(planeEdges);
    }

    if (scene3d.world.gridEnabled) {
      const grid = new THREE.GridHelper(
        Math.max(scene3d.world.gridSize * pixelScale, 0.001),
        scene3d.world.gridDivisions,
        0x334155,
        0x1f2937,
      );
      grid.position.y = (-scene3d.bounds.y * pixelScale) / 2;
      scene.add(grid);
    }

    if (scene3d.world.showAxes) {
      const axes = new THREE.AxesHelper(
        Math.max(scene3d.bounds.x, scene3d.bounds.y) * pixelScale * 0.18,
      );
      scene.add(axes);
    }

    const sceneCameraItem = scene3d.items.find((item) => item.type === 'camera');
    if (itemVisible(sceneCameraItem)) {
      const shotCamera = new THREE.PerspectiveCamera(
        scene3d.camera.fov,
        Math.max(scene3d.bounds.x / scene3d.bounds.y, 0.001),
        Math.max(scene3d.camera.near * pixelScale, 0.001),
        Math.max(scene3d.camera.far * pixelScale, 10),
      );
      shotCamera.position.copy(sceneCameraPosition);
      shotCamera.quaternion.copy(sceneCameraOrientation);
      shotCamera.updateMatrixWorld(true);
      const helper = new THREE.CameraHelper(shotCamera);
      helper.visible = true;
      scene.add(helper);

      const cameraBody = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.16, 0.12),
        new THREE.MeshBasicMaterial({ color: parseColor(sceneCameraItem?.color, '#e5e7eb') }),
      );
      cameraBody.position.copy(shotCamera.position);
      scene.add(cameraBody);
    }

    for (const item of scene3d.items) {
      if (!item.visible || item.type === 'output_plane' || item.type === 'camera') continue;

      if (item.type === 'light') {
        const light = new THREE.DirectionalLight(
          parseColor(item.color, '#fef3c7'),
          item.intensity ?? 2,
        );
        applyItemTransform(light, item, pixelScale);
        light.target.position.copy(target);
        scene.add(light);
        scene.add(light.target);

        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(0.12, 16, 12),
          new THREE.MeshBasicMaterial({ color: parseColor(item.color, '#fef3c7') }),
        );
        marker.position.copy(light.position);
        scene.add(marker);
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
          color: parseColor(item.color, '#38bdf8'),
          roughness: 0.42,
          metalness: 0.08,
          transparent: true,
          opacity: 0.82,
        });
        const mesh = new THREE.Mesh(geometry, material);
        applyItemTransform(mesh, item, pixelScale);
        scene.add(mesh);

        const edges = createLineBox(
          size,
          pixelScale,
          selectedItemIdRef.current === item.id ? BOX_EDGE_COLOR_SELECTED : BOX_EDGE_COLOR_DEFAULT,
          0.9,
        );
        applyItemTransform(edges, item, pixelScale);
        scene.add(edges);
        bindings.set(item.id, { type: 'box', edges });
        continue;
      }

      if (item.type === 'model' || item.type === 'splat') {
        const { group: placeholder, marker: placeholderMarker } = createAssetPlaceholder(
          item,
          pixelScale,
          selectedItemIdRef.current === item.id,
        );
        scene.add(placeholder);

        const assetBinding: SceneItemBinding = {
          type: 'asset',
          assetPlaceholder: placeholderMarker,
          assetPlaceholderColor: isScene3DSplatItem(item)
            ? SPLAT_PLACEHOLDER_COLOR_DEFAULT
            : MODEL_PLACEHOLDER_COLOR_DEFAULT,
        };
        bindings.set(item.id, assetBinding);

        if (!item.asset?.assetId) continue;

        void (async () => {
          try {
            const blob = await getAsset(item.asset.assetId);
            if (!blob || disposed) return;

            const importedObject = await loadScene3DAssetObject(item, blob, objectUrls);
            if (disposed) {
              disposeObject(importedObject);
              return;
            }

            scene.remove(placeholder);
            disposeObject(placeholder);

            const root = new THREE.Group();
            fitImportedObjectToScene(importedObject, scene3d, pixelScale);
            root.add(importedObject);
            applyItemTransform(root, item, pixelScale);
            scene.add(root);
            root.updateMatrixWorld(true);

            const box = getImportedObjectBox(importedObject, true);
            if (!box.isEmpty()) {
              const helper = new THREE.Box3Helper(box, new THREE.Color('#f8fafc'));
              helper.visible = selectedItemIdRef.current === item.id;
              scene.add(helper);
              assetBinding.assetHelper = helper;
            }
          } catch (error) {
            console.error(`Failed to load 3D asset ${item.asset?.fileName ?? item.name}`, error);
            const errorMarker = createLineBox(
              item.size ?? { x: 120, y: 120, z: 120 },
              pixelScale,
              '#fb7185',
              0.9,
            );
            applyItemTransform(errorMarker, item, pixelScale);
            if (!disposed) {
              scene.remove(placeholder);
              disposeObject(placeholder);
              scene.add(errorMarker);
            }
          }
        })();
        continue;
      }

      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 12, 8),
        new THREE.MeshBasicMaterial({ color: parseColor(item.color, '#a7f3d0') }),
      );
      applyItemTransform(marker, item, pixelScale);
      scene.add(marker);
    }

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
      renderer.render(scene, camera);
    };
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
      resetViewRef.current = () => {};
      outputTexture?.dispose();
      objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
      [...scene.children].forEach((child) => {
        scene.remove(child);
        disposeObject(child);
      });
      renderer.dispose();
      renderer.domElement.remove();
      sceneContextRef.current = null;
      applyProjectionTransformRef.current = null;
      applyViewportCameraModeRef.current = null;
      syncActiveStateRef.current = null;
    };
  }, [
    backdropCanvas,
    hasBackdropOutput,
    onViewportCameraModeChange,
    scene3DNode.id,
    scene3d,
    sceneNode.height,
    sceneNode.width,
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
