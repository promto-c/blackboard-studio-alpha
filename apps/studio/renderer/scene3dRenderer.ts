import * as THREE from 'three';
import type {
  Scene3DItem,
  Scene3DNode,
  Scene3DSettings,
  Scene3DVector3,
  Scene3DWorldSettings,
  SceneNode,
} from '@blackboard/types';
import { configureRawStraightAlphaTexture } from '@blackboard/renderer';
import { normalizeScene3DSettings } from '@/nodes/builtin/scene_3d/scene3d';
import { getAsset } from '@/state/assetStorage';

export const SCENE_3D_RENDER_COLOR_BOUNDARY = {
  outputContract: 'pipeline',
  rendererWorkingSpace: 'scene_linear',
  renderTargetColorSpace: 'scene_linear',
  backdropInput: 'scene_linear',
} as const;

export type Scene3DColorTransform = (
  color: readonly [number, number, number],
) => [number, number, number];
export type Scene3DColorRole = 'environment' | 'base_color' | 'light';

export const identityScene3DColorTransform: Scene3DColorTransform = ([r, g, b]) => [r, g, b];

export const scene3DToRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export const parseScene3DColor = (value: string | undefined, fallback: string): THREE.Color => {
  try {
    return new THREE.Color(value || fallback);
  } catch {
    return new THREE.Color(fallback);
  }
};

export const createScene3DSceneLinearColor = (
  value: string | undefined,
  fallback: string,
  transformColorPickingToSceneLinear: Scene3DColorTransform,
  _role: Scene3DColorRole = 'base_color',
): THREE.Color => {
  const pickedColor = parseScene3DColor(value, fallback).convertLinearToSRGB();
  const [r, g, b] = transformColorPickingToSceneLinear([
    pickedColor.r,
    pickedColor.g,
    pickedColor.b,
  ]);
  return new THREE.Color(r, g, b);
};

export const getScene3DPositiveIntensity = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;

export const createScene3DBaseColor = (
  item: Pick<Scene3DItem, 'color'>,
  fallback: string,
  transformColorPickingToSceneLinear: Scene3DColorTransform,
): THREE.Color =>
  createScene3DSceneLinearColor(
    item.color,
    fallback,
    transformColorPickingToSceneLinear,
    'base_color',
  );

export const createScene3DLightColor = (
  item: Pick<Scene3DItem, 'color'>,
  fallback: string,
  transformColorPickingToSceneLinear: Scene3DColorTransform,
): THREE.Color =>
  createScene3DSceneLinearColor(item.color, fallback, transformColorPickingToSceneLinear, 'light');

export const scaleScene3DVector = (value: Scene3DVector3, scale: number): THREE.Vector3 =>
  new THREE.Vector3(value.x * scale, value.y * scale, value.z * scale);

export type Scene3DBackdropTextureOrigin = 'render-target' | 'dom-canvas';

export const createScene3DBackdropPlaneGeometry = (
  width: number,
  height: number,
  textureOrigin: Scene3DBackdropTextureOrigin = 'render-target',
): THREE.PlaneGeometry => {
  const geometry = new THREE.PlaneGeometry(width, height);
  if (textureOrigin === 'dom-canvas') {
    const uv = geometry.getAttribute('uv');
    for (let index = 0; index < uv.count; index += 1) {
      uv.setY(index, 1 - uv.getY(index));
    }
    uv.needsUpdate = true;
  }
  return geometry;
};

export const applyScene3DItemTransform = (
  object: THREE.Object3D,
  item: Scene3DItem,
  pixelScale: number,
): void => {
  object.position.copy(scaleScene3DVector(item.transform.position, pixelScale));
  object.rotation.set(
    scene3DToRadians(item.transform.rotation.x),
    scene3DToRadians(item.transform.rotation.y),
    scene3DToRadians(item.transform.rotation.z),
  );
  object.scale.set(item.transform.scale.x, item.transform.scale.y, item.transform.scale.z);
};

export const isScene3DItemVisible = (item: Scene3DItem | undefined): boolean =>
  item?.visible !== false;

export const isScene3DSplatItem = (item: Scene3DItem): boolean =>
  item.type === 'splat' || item.asset?.kind === 'splat';

const SCENE_3D_SPLAT_IMPORT_ORIENTATION = new THREE.Quaternion(1, 0, 0, 0);

export const applyScene3DSplatImportOrientation = (object: THREE.Object3D): THREE.Object3D => {
  object.quaternion.premultiply(SCENE_3D_SPLAT_IMPORT_ORIENTATION);
  object.updateMatrixWorld(true);
  return object;
};

export const disposeScene3DObject = (object: THREE.Object3D): void => {
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

export const createScene3DLineBox = (
  size: Scene3DVector3,
  pixelScale: number,
  color: string,
  opacity = 1,
): THREE.LineSegments => {
  const geometry = new THREE.BoxGeometry(
    Math.max(size.x * pixelScale, 0.001),
    Math.max(size.y * pixelScale, 0.001),
    Math.max(size.z * pixelScale, 0.001),
  );
  const edges = new THREE.EdgesGeometry(geometry);
  geometry.dispose();
  const material = new THREE.LineBasicMaterial({
    color: parseScene3DColor(color, '#22d3ee'),
    transparent: opacity < 1,
    opacity,
  });
  return new THREE.LineSegments(edges, material);
};

export const createScene3DCameraOrientation = (
  position: THREE.Vector3,
  target: THREE.Vector3,
): THREE.Quaternion => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.copy(position);
  camera.lookAt(target);
  return camera.quaternion.clone();
};

export const applyScene3DBackdropPlaneTransform = (
  object: THREE.Object3D,
  center: THREE.Vector3,
  cameraOrientation: THREE.Quaternion,
): void => {
  object.position.copy(center);
  object.quaternion.copy(cameraOrientation);
};

export const createScene3DGeometryObject = (
  geometry: THREE.BufferGeometry,
  item: Scene3DItem,
  transformColorPickingToSceneLinear: Scene3DColorTransform = identityScene3DColorTransform,
): THREE.Object3D => {
  if (!geometry.getAttribute('normal')) {
    geometry.computeVertexNormals();
  }
  const material = new THREE.MeshStandardMaterial({
    color: createScene3DBaseColor(item, '#e5e7eb', transformColorPickingToSceneLinear),
    roughness: 0.58,
    metalness: 0.04,
    vertexColors: Boolean(geometry.getAttribute('color')),
  });
  return new THREE.Mesh(geometry, material);
};

export const prepareScene3DLoadedObject = (
  object: THREE.Object3D,
  item: Scene3DItem,
  transformColorPickingToSceneLinear: Scene3DColorTransform = identityScene3DColorTransform,
): THREE.Object3D => {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry && !mesh.geometry.getAttribute('normal')) {
      mesh.geometry.computeVertexNormals();
    }
    if (!mesh.material) {
      mesh.material = new THREE.MeshStandardMaterial({
        color: createScene3DBaseColor(item, '#e5e7eb', transformColorPickingToSceneLinear),
        roughness: 0.58,
        metalness: 0.04,
      });
    }
  });
  return object;
};

export const getImportedScene3DObjectBox = (
  object: THREE.Object3D,
  applyWorldTransform = false,
): THREE.Box3 => {
  const splatObject = object as THREE.Object3D & { getBoundingBox?: () => THREE.Box3 };
  if (typeof splatObject.getBoundingBox === 'function') {
    const box = splatObject.getBoundingBox().clone();
    return applyWorldTransform ? box.applyMatrix4(object.matrixWorld) : box;
  }
  return new THREE.Box3().setFromObject(object);
};

export const fitImportedScene3DObjectToScene = (
  object: THREE.Object3D,
  scene3d: Scene3DSettings,
  pixelScale: number,
): void => {
  const box = getImportedScene3DObjectBox(object);
  if (box.isEmpty()) return;

  const size = box.getSize(new THREE.Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxAxis) || maxAxis <= 0) return;

  const center = box.getCenter(new THREE.Vector3());
  const canvasSpan = Math.min(scene3d.bounds.x, scene3d.bounds.y) * pixelScale;
  const depthSpan = scene3d.bounds.z * pixelScale;
  const targetSpan = Math.max(Math.min(canvasSpan * 0.42, depthSpan * 0.9), 1);
  const fitScale = targetSpan / maxAxis;
  object.scale.multiplyScalar(fitScale);
  object.position.sub(center.multiply(object.scale).applyQuaternion(object.quaternion));
  object.updateMatrixWorld(true);
};

export const configureScene3DSceneLinearRenderer = (
  renderer: THREE.WebGLRenderer,
): THREE.WebGLRenderer => {
  if (renderer.outputColorSpace !== THREE.LinearSRGBColorSpace) {
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  }
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
  return renderer;
};

export const configureScene3DSceneLinearTexture = <T extends THREE.Texture>(texture: T): T => {
  configureRawStraightAlphaTexture(texture);
  return texture;
};

/**
 * The compositor uses color-only targets for 2D passes. Scene rendering needs
 * a depth attachment so opaque geometry cannot be overwritten by later draw
 * calls such as the output plane. Disposing invalidates the existing
 * framebuffer; Three.js recreates it with depth on the next bind.
 */
export const configureScene3DDepthRenderTarget = <T extends THREE.WebGLRenderTarget>(
  target: T,
): T => {
  if (!target.depthBuffer || target.stencilBuffer) {
    target.depthBuffer = true;
    target.stencilBuffer = false;
    target.dispose();
  }
  return target;
};

export interface Scene3DCameraRuntime {
  camera: THREE.PerspectiveCamera;
  target: THREE.Vector3;
  position: THREE.Vector3;
  orientation: THREE.Quaternion;
}

export const createScene3DRenderCamera = (
  scene3d: Scene3DSettings,
  pixelScale: number,
  aspect: number,
): Scene3DCameraRuntime => {
  const position = scaleScene3DVector(scene3d.camera.position, pixelScale);
  const target = scaleScene3DVector(scene3d.camera.target, pixelScale);
  const orientation = createScene3DCameraOrientation(position, target);
  const sceneSpan = Math.max(scene3d.bounds.x, scene3d.bounds.y, scene3d.bounds.z) * pixelScale;
  const camera = new THREE.PerspectiveCamera(
    scene3d.camera.fov,
    Math.max(aspect, 0.001),
    Math.max(scene3d.camera.near * pixelScale, 0.001),
    Math.max(scene3d.camera.far * pixelScale, position.distanceTo(target) + sceneSpan * 2, 10),
  );
  camera.position.copy(position);
  camera.quaternion.copy(orientation);
  camera.updateProjectionMatrix();
  return { camera, target, position, orientation };
};

export const createScene3DEnvironmentLight = (
  world: Pick<
    Scene3DWorldSettings,
    'environmentColor' | 'environmentGroundColor' | 'environmentIntensity'
  >,
  transformColorPickingToSceneLinear: Scene3DColorTransform,
): THREE.HemisphereLight =>
  new THREE.HemisphereLight(
    createScene3DSceneLinearColor(
      world.environmentColor,
      '#ffffff',
      transformColorPickingToSceneLinear,
      'environment',
    ),
    createScene3DSceneLinearColor(
      world.environmentGroundColor,
      '#1f2937',
      transformColorPickingToSceneLinear,
      'environment',
    ),
    getScene3DPositiveIntensity(world.environmentIntensity, 1.2),
  );

interface Scene3DRenderableSceneOptions {
  node: Scene3DNode;
  sceneNode: Pick<SceneNode, 'width' | 'height'>;
  aspect: number;
  backdropTexture?: THREE.Texture;
  transformColorPickingToSceneLinear?: Scene3DColorTransform;
  assetObjects?: ReadonlyMap<string, THREE.Object3D>;
  splatRenderer?: THREE.Object3D | null;
}

export interface Scene3DRenderableScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  scene3d: Scene3DSettings;
  dispose: () => void;
}

export const createScene3DRenderableScene = ({
  node,
  sceneNode,
  aspect,
  backdropTexture,
  transformColorPickingToSceneLinear = identityScene3DColorTransform,
  assetObjects,
  splatRenderer,
}: Scene3DRenderableSceneOptions): Scene3DRenderableScene => {
  const scene3d = normalizeScene3DSettings(
    { scene3d: node.scene3d },
    { width: sceneNode.width, height: sceneNode.height },
  );
  const pixelScale = scene3d.world.pixelScale;
  const scene = new THREE.Scene();
  const borrowedAssetRoots: Array<{ root: THREE.Group; object: THREE.Object3D }> = [];
  const { camera, target, orientation } = createScene3DRenderCamera(scene3d, pixelScale, aspect);
  scene.add(createScene3DEnvironmentLight(scene3d.world, transformColorPickingToSceneLinear));
  if (splatRenderer) {
    scene.add(splatRenderer);
  }

  const outputPlaneItem = scene3d.items.find((item) => item.type === 'output_plane');
  if (backdropTexture && scene3d.world.showOutputPlane && isScene3DItemVisible(outputPlaneItem)) {
    const geometry = createScene3DBackdropPlaneGeometry(
      Math.max(scene3d.bounds.x * pixelScale, 0.001),
      Math.max(scene3d.bounds.y * pixelScale, 0.001),
      'render-target',
    );
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: backdropTexture,
      transparent: false,
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
    });
    const plane = new THREE.Mesh(geometry, material);
    plane.name = outputPlaneItem?.id ?? 'scene3d_output_plane';
    plane.renderOrder = -1000;
    applyScene3DBackdropPlaneTransform(plane, target, orientation);
    scene.add(plane);
  }

  for (const item of scene3d.items) {
    if (!item.visible || item.type === 'output_plane' || item.type === 'camera') continue;

    if (item.type === 'light') {
      const light = new THREE.DirectionalLight(
        createScene3DLightColor(item, '#fef3c7', transformColorPickingToSceneLinear),
        getScene3DPositiveIntensity(item.intensity, 2),
      );
      light.name = item.id;
      applyScene3DItemTransform(light, item, pixelScale);
      light.target.position.copy(target);
      scene.add(light);
      scene.add(light.target);
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
        color: createScene3DBaseColor(item, '#38bdf8', transformColorPickingToSceneLinear),
        roughness: 0.42,
        metalness: 0.08,
        transparent: true,
        opacity: 0.82,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = item.id;
      applyScene3DItemTransform(mesh, item, pixelScale);
      scene.add(mesh);
      continue;
    }

    if (item.type === 'model' || item.type === 'splat') {
      const assetObject = assetObjects?.get(item.id);
      if (!assetObject) continue;
      const root = new THREE.Group();
      root.name = item.id;
      root.add(assetObject);
      applyScene3DItemTransform(root, item, pixelScale);
      scene.add(root);
      borrowedAssetRoots.push({ root, object: assetObject });
    }
  }

  return {
    scene,
    camera,
    scene3d,
    dispose: () => {
      borrowedAssetRoots.forEach(({ root, object }) => {
        root.remove(object);
        scene.remove(root);
      });
      if (splatRenderer) {
        scene.remove(splatRenderer);
      }
      [...scene.children].forEach((child) => {
        scene.remove(child);
        disposeScene3DObject(child);
      });
    },
  };
};

interface Scene3DProjectionAssetEntry {
  key: string;
  object: THREE.Object3D | null;
  promise: Promise<void>;
}

interface Scene3DProjectionRuntime {
  assets: Map<string, Scene3DProjectionAssetEntry>;
  splatRuntimePromise: Promise<typeof import('./scene3dSplatRuntime')> | null;
  splatRenderer: THREE.Object3D | null;
  onDirty?: () => void;
  disposed: boolean;
}

const scene3DProjectionRuntimes = new WeakMap<
  THREE.WebGLRenderer,
  Map<string, Scene3DProjectionRuntime>
>();

const getScene3DProjectionRuntime = (
  renderer: THREE.WebGLRenderer,
  nodeId: string,
): Scene3DProjectionRuntime => {
  let rendererRuntimes = scene3DProjectionRuntimes.get(renderer);
  if (!rendererRuntimes) {
    rendererRuntimes = new Map();
    scene3DProjectionRuntimes.set(renderer, rendererRuntimes);
  }
  let runtime = rendererRuntimes.get(nodeId);
  if (!runtime) {
    runtime = {
      assets: new Map(),
      splatRuntimePromise: null,
      splatRenderer: null,
      disposed: false,
    };
    rendererRuntimes.set(nodeId, runtime);
  }
  return runtime;
};

const getScene3DProjectionAssetKey = (
  item: Scene3DItem,
  scene3d: Scene3DSettings,
  transformColorPickingToSceneLinear: Scene3DColorTransform,
): string | null => {
  if (!item.asset?.assetId) return null;
  const color = createScene3DBaseColor(
    item,
    item.type === 'splat' ? '#67e8f9' : '#e5e7eb',
    transformColorPickingToSceneLinear,
  );
  return [
    item.type,
    item.asset.assetId,
    item.asset.kind ?? '',
    item.asset.format ?? '',
    scene3d.bounds.x,
    scene3d.bounds.y,
    scene3d.bounds.z,
    scene3d.world.pixelScale,
    color.r.toFixed(6),
    color.g.toFixed(6),
    color.b.toFixed(6),
  ].join('|');
};

const disposeScene3DProjectionRuntime = (runtime: Scene3DProjectionRuntime): void => {
  runtime.disposed = true;
  runtime.assets.forEach((entry) => {
    if (entry.object) disposeScene3DObject(entry.object);
  });
  runtime.assets.clear();
  if (runtime.splatRenderer) {
    disposeScene3DObject(runtime.splatRenderer);
    runtime.splatRenderer = null;
  }
};

export const disposeScene3DProjectionRuntimes = (renderer: THREE.WebGLRenderer): void => {
  const runtimes = scene3DProjectionRuntimes.get(renderer);
  if (!runtimes) return;
  runtimes.forEach(disposeScene3DProjectionRuntime);
  runtimes.clear();
  scene3DProjectionRuntimes.delete(renderer);
};

export const pruneScene3DProjectionRuntimes = (
  renderer: THREE.WebGLRenderer,
  retainedNodeIds: ReadonlySet<string>,
): void => {
  const runtimes = scene3DProjectionRuntimes.get(renderer);
  if (!runtimes) return;
  runtimes.forEach((runtime, nodeId) => {
    if (retainedNodeIds.has(nodeId)) return;
    disposeScene3DProjectionRuntime(runtime);
    runtimes.delete(nodeId);
  });
  if (runtimes.size === 0) {
    scene3DProjectionRuntimes.delete(renderer);
  }
};

export const prepareScene3DProjectionAssets = async ({
  renderer,
  node,
  sceneNode,
  transformColorPickingToSceneLinear = identityScene3DColorTransform,
  onDirty,
}: {
  renderer: THREE.WebGLRenderer;
  node: Scene3DNode;
  sceneNode: Pick<SceneNode, 'width' | 'height'>;
  transformColorPickingToSceneLinear?: Scene3DColorTransform;
  onDirty?: () => void;
}): Promise<void> => {
  const scene3d = normalizeScene3DSettings(
    { scene3d: node.scene3d },
    { width: sceneNode.width, height: sceneNode.height },
  );
  const runtime = getScene3DProjectionRuntime(renderer, node.id);
  if (onDirty) runtime.onDirty = onDirty;
  const activeItemIds = new Set(
    scene3d.items
      .filter(
        (item) =>
          item.visible &&
          (item.type === 'model' || item.type === 'splat') &&
          Boolean(item.asset?.assetId),
      )
      .map((item) => item.id),
  );

  runtime.assets.forEach((entry, itemId) => {
    if (activeItemIds.has(itemId)) return;
    if (entry.object) disposeScene3DObject(entry.object);
    runtime.assets.delete(itemId);
  });

  await Promise.all(
    scene3d.items.map(async (item) => {
      if (
        !item.visible ||
        (item.type !== 'model' && item.type !== 'splat') ||
        !item.asset?.assetId
      ) {
        return;
      }
      const key = getScene3DProjectionAssetKey(item, scene3d, transformColorPickingToSceneLinear);
      if (!key) return;
      const current = runtime.assets.get(item.id);
      if (current?.key === key) {
        await current.promise;
        return;
      }
      if (current?.object) disposeScene3DObject(current.object);

      const entry: Scene3DProjectionAssetEntry = {
        key,
        object: null,
        promise: Promise.resolve(),
      };
      runtime.assets.set(item.id, entry);
      entry.promise = (async () => {
        const blob = await getAsset(item.asset!.assetId);
        if (!blob) {
          throw new Error(`Missing 3D asset: ${item.asset!.fileName}`);
        }
        const { loadScene3DAssetObject } = await import('./scene3dAssetLoader');
        const loaded = await loadScene3DAssetObject(
          item,
          blob,
          () => {
            runtime.splatRuntimePromise ??= import('./scene3dSplatRuntime');
            return runtime.splatRuntimePromise;
          },
          transformColorPickingToSceneLinear,
        );
        if (runtime.disposed || runtime.assets.get(item.id) !== entry) {
          disposeScene3DObject(loaded.object);
          return;
        }
        fitImportedScene3DObjectToScene(loaded.object, scene3d, scene3d.world.pixelScale);
        entry.object = loaded.object;
        if (loaded.usesSplatRenderer && !runtime.splatRenderer) {
          const splatRuntime =
            runtime.splatRuntimePromise ??
            (runtime.splatRuntimePromise = import('./scene3dSplatRuntime'));
          const module = await splatRuntime;
          if (runtime.disposed) return;
          runtime.splatRenderer = module.createScene3DSplatRenderer(renderer, () =>
            runtime.onDirty?.(),
          );
        }
      })().catch((error) => {
        if (runtime.assets.get(item.id) === entry) {
          runtime.assets.delete(item.id);
        }
        throw error;
      });
      await entry.promise;
    }),
  );
};

const getReadyScene3DProjectionAssets = ({
  renderer,
  node,
  scene3d,
  transformColorPickingToSceneLinear,
}: {
  renderer: THREE.WebGLRenderer;
  node: Scene3DNode;
  scene3d: Scene3DSettings;
  transformColorPickingToSceneLinear: Scene3DColorTransform;
}): { objects: Map<string, THREE.Object3D>; splatRenderer: THREE.Object3D | null } => {
  const runtime = getScene3DProjectionRuntime(renderer, node.id);
  const objects = new Map<string, THREE.Object3D>();
  scene3d.items.forEach((item) => {
    const key = getScene3DProjectionAssetKey(item, scene3d, transformColorPickingToSceneLinear);
    const entry = runtime.assets.get(item.id);
    if (key && entry?.key === key && entry.object) {
      objects.set(item.id, entry.object);
    }
  });
  return { objects, splatRenderer: runtime.splatRenderer };
};

interface Scene3DTargetRenderOptions {
  renderer: THREE.WebGLRenderer;
  target: THREE.WebGLRenderTarget;
  node: Scene3DNode;
  sceneNode: Pick<SceneNode, 'width' | 'height'>;
  backdropTexture?: THREE.Texture;
  transformColorPickingToSceneLinear?: Scene3DColorTransform;
  clearRenderTargetTransparent: (target: THREE.WebGLRenderTarget) => void;
}

interface PreparedScene3DTargetRender {
  renderableScene: Scene3DRenderableScene;
  splatRenderer: THREE.Object3D | null;
}

const prepareScene3DTargetRender = ({
  renderer,
  target,
  node,
  sceneNode,
  backdropTexture,
  transformColorPickingToSceneLinear,
}: Scene3DTargetRenderOptions): PreparedScene3DTargetRender => {
  configureScene3DDepthRenderTarget(target);
  configureScene3DSceneLinearTexture(target.texture);
  const aspect =
    target.height > 0 ? target.width / target.height : sceneNode.width / sceneNode.height;
  const scene3d = normalizeScene3DSettings(
    { scene3d: node.scene3d },
    { width: sceneNode.width, height: sceneNode.height },
  );
  const colorTransform = transformColorPickingToSceneLinear ?? identityScene3DColorTransform;
  const projectionAssets = getReadyScene3DProjectionAssets({
    renderer,
    node,
    scene3d,
    transformColorPickingToSceneLinear: colorTransform,
  });
  return {
    renderableScene: createScene3DRenderableScene({
      node,
      sceneNode,
      aspect,
      backdropTexture,
      transformColorPickingToSceneLinear: colorTransform,
      assetObjects: projectionAssets.objects,
      splatRenderer: projectionAssets.splatRenderer,
    }),
    splatRenderer: projectionAssets.splatRenderer,
  };
};

const drawPreparedScene3DToTarget = (
  {
    renderer,
    target,
    clearRenderTargetTransparent,
  }: Pick<Scene3DTargetRenderOptions, 'renderer' | 'target' | 'clearRenderTargetTransparent'>,
  renderableScene: Scene3DRenderableScene,
): boolean => {
  const previousTarget = renderer.getRenderTarget();
  const previousOutputColorSpace = renderer.outputColorSpace;
  const previousToneMapping = renderer.toneMapping;
  const previousToneMappingExposure = renderer.toneMappingExposure;

  try {
    configureScene3DSceneLinearRenderer(renderer);
    clearRenderTargetTransparent(target);
    renderer.setRenderTarget(target);
    renderer.render(renderableScene.scene, renderableScene.camera);
    return true;
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.outputColorSpace = previousOutputColorSpace;
    renderer.toneMapping = previousToneMapping;
    renderer.toneMappingExposure = previousToneMappingExposure;
    renderableScene.dispose();
  }
};

export const renderScene3DToTarget = (options: Scene3DTargetRenderOptions): boolean => {
  const { renderableScene } = prepareScene3DTargetRender(options);
  return drawPreparedScene3DToTarget(options, renderableScene);
};

export const updateScene3DSplatProjection = async ({
  splatRenderer,
  scene,
  camera,
  width,
  height,
}: {
  splatRenderer: THREE.Object3D | null;
  scene: THREE.Scene;
  camera: THREE.Camera;
  width: number;
  height: number;
}): Promise<void> => {
  const updatableSplatRenderer = splatRenderer as
    | (THREE.Object3D & {
        renderSize?: THREE.Vector2;
        update?: (options: { scene: THREE.Scene; camera: THREE.Camera }) => Promise<void>;
      })
    | null;
  if (!updatableSplatRenderer?.update) return;

  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  updatableSplatRenderer.renderSize?.set(width, height);
  await updatableSplatRenderer.update({ scene, camera });
};

export const renderScene3DToTargetAsync = async (
  options: Scene3DTargetRenderOptions,
): Promise<boolean> => {
  const prepared = prepareScene3DTargetRender(options);

  try {
    await updateScene3DSplatProjection({
      splatRenderer: prepared.splatRenderer,
      scene: prepared.renderableScene.scene,
      camera: prepared.renderableScene.camera,
      width: options.target.width,
      height: options.target.height,
    });
    return drawPreparedScene3DToTarget(options, prepared.renderableScene);
  } catch (error) {
    prepared.renderableScene.dispose();
    throw error;
  }
};
