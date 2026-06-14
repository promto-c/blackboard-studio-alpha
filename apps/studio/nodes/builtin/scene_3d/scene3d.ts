import type {
  Scene3DAssetReference,
  Scene3DCameraSettings,
  Scene3DItem,
  Scene3DItemTransform,
  Scene3DNode,
  Scene3DSettings,
  Scene3DVector3,
} from '@blackboard/types';
import { getScene3DAssetKind } from './scene3dModelAssets';

export const DEFAULT_SCENE_3D_FOV = 45;
export const MIN_SCENE_3D_BACKDROP_DISTANCE = 1;
export const DEFAULT_SCENE_3D_PIXEL_SCALE = 0.01;

export interface Scene3DCanvasSize {
  width: number;
  height: number;
}

export interface Scene3DBackdropRect {
  width: number;
  height: number;
  distance: number;
  aspect: number;
}

const DEFAULT_CANVAS_SIZE: Scene3DCanvasSize = { width: 1920, height: 1080 };
const MIN_SCENE_3D_FOV = 1;
const MAX_SCENE_3D_FOV = 160;

const vector3 = (x: number, y: number, z: number): Scene3DVector3 => ({ x, y, z });

const identityTransform = (position = vector3(0, 0, 0)): Scene3DItemTransform => ({
  position,
  rotation: vector3(0, 0, 0),
  scale: vector3(1, 1, 1),
});

const clampPositive = (value: unknown, fallback: number, min = 0.001): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, value);
};

const numberOrFallback = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

const clampFov = (value: unknown, fallback = DEFAULT_SCENE_3D_FOV): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_SCENE_3D_FOV, Math.max(MIN_SCENE_3D_FOV, value));
};

const safeCanvasSize = (canvasSize: Scene3DCanvasSize): Scene3DCanvasSize => ({
  width: clampPositive(canvasSize.width, DEFAULT_CANVAS_SIZE.width, 1),
  height: clampPositive(canvasSize.height, DEFAULT_CANVAS_SIZE.height, 1),
});

export const getScene3DBackdropDistanceForCanvas = (
  canvasSize: Scene3DCanvasSize,
  fov = DEFAULT_SCENE_3D_FOV,
): number => {
  const safeSize = safeCanvasSize(canvasSize);
  const safeFov = clampFov(fov);
  return safeSize.height / (2 * Math.tan(toRadians(safeFov) / 2));
};

export const DEFAULT_SCENE_3D_DEPTH = getScene3DBackdropDistanceForCanvas(
  DEFAULT_CANVAS_SIZE,
  DEFAULT_SCENE_3D_FOV,
);

export const getScene3DBackdropRect = ({
  canvasSize,
  fov = DEFAULT_SCENE_3D_FOV,
  distance,
}: {
  canvasSize: Scene3DCanvasSize;
  fov?: number;
  distance?: number;
}): Scene3DBackdropRect => {
  const safeSize = safeCanvasSize(canvasSize);
  const safeFov = clampFov(fov);
  const safeDistance = clampPositive(
    distance,
    getScene3DBackdropDistanceForCanvas(safeSize, safeFov),
    MIN_SCENE_3D_BACKDROP_DISTANCE,
  );
  const height = 2 * safeDistance * Math.tan(toRadians(safeFov) / 2);
  const aspect = safeSize.width / safeSize.height;

  return {
    width: height * aspect,
    height,
    distance: safeDistance,
    aspect,
  };
};

export const getScene3DCameraDistance = (
  camera: Pick<Scene3DCameraSettings, 'position' | 'target'>,
): number => {
  const dx = numberOrFallback(camera.position?.x, 0) - numberOrFallback(camera.target?.x, 0);
  const dy = numberOrFallback(camera.position?.y, 0) - numberOrFallback(camera.target?.y, 0);
  const dz = numberOrFallback(camera.position?.z, 0) - numberOrFallback(camera.target?.z, 0);
  return Math.hypot(dx, dy, dz);
};

const positionCameraAtDistance = (
  position: Scene3DVector3,
  target: Scene3DVector3,
  distance: number,
): Scene3DVector3 => {
  const dx = numberOrFallback(position.x, 0) - target.x;
  const dy = numberOrFallback(position.y, 0) - target.y;
  const dz = numberOrFallback(position.z, 0) - target.z;
  const currentDistance = Math.hypot(dx, dy, dz);

  if (currentDistance <= 0.0001) {
    return vector3(target.x, target.y, target.z + distance);
  }

  const scale = distance / currentDistance;
  return vector3(target.x + dx * scale, target.y + dy * scale, target.z + dz * scale);
};

export const setScene3DBackdropDistance = (
  settings: Scene3DSettings,
  distance: number,
): Scene3DSettings => {
  const safeDistance = clampPositive(distance, settings.bounds.z, MIN_SCENE_3D_BACKDROP_DISTANCE);

  return {
    ...settings,
    bounds: {
      ...settings.bounds,
      z: safeDistance,
    },
    camera: {
      ...settings.camera,
      position: positionCameraAtDistance(
        settings.camera.position,
        settings.camera.target,
        safeDistance,
      ),
    },
  };
};

export const syncScene3DBackdropDistanceToCamera = (
  settings: Scene3DSettings,
): Scene3DSettings => ({
  ...settings,
  bounds: {
    ...settings.bounds,
    z: Math.max(MIN_SCENE_3D_BACKDROP_DISTANCE, getScene3DCameraDistance(settings.camera)),
  },
});

const createScene3DItemId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

const getBasenameWithoutExtension = (fileName: string): string => {
  const normalized = fileName.split(/[\\/]/).pop()?.trim() || fileName.trim();
  return normalized.replace(/\.[^.]+$/, '') || 'Imported Model';
};

const uniqueItemName = (items: Scene3DItem[], baseName: string): string => {
  const usedNames = new Set(items.map((item) => item.name));
  if (!usedNames.has(baseName)) return baseName;

  let index = 2;
  while (usedNames.has(`${baseName} ${index}`)) {
    index += 1;
  }
  return `${baseName} ${index}`;
};

const defaultItems = (backdropRect: Scene3DBackdropRect): Scene3DItem[] => [
  {
    id: 'scene3d_output_plane',
    name: 'Output Plane',
    type: 'output_plane',
    visible: true,
    locked: true,
    transform: identityTransform(),
    size: vector3(backdropRect.width, backdropRect.height, 0),
    color: '#111827',
  },
  {
    id: 'scene3d_camera',
    name: 'Scene Camera',
    type: 'camera',
    visible: true,
    locked: true,
    transform: identityTransform(vector3(0, 0, backdropRect.distance)),
    color: '#f8fafc',
  },
  {
    id: 'scene3d_key_light',
    name: 'Key Light',
    type: 'light',
    visible: true,
    transform: identityTransform(
      vector3(backdropRect.width * 0.24, backdropRect.height * 0.32, backdropRect.distance * 0.8),
    ),
    color: '#f8fafc',
    intensity: 3,
  },
];

export const createDefaultScene3DSettings = (
  width: number,
  height: number,
  backdropDistance = getScene3DBackdropDistanceForCanvas({ width, height }, DEFAULT_SCENE_3D_FOV),
  fov = DEFAULT_SCENE_3D_FOV,
): Scene3DSettings => {
  const safeFov = clampFov(fov);
  const backdropRect = getScene3DBackdropRect({
    canvasSize: { width, height },
    fov: safeFov,
    distance: backdropDistance,
  });

  return {
    bounds: vector3(backdropRect.width, backdropRect.height, backdropRect.distance),
    camera: {
      position: vector3(0, 0, backdropRect.distance),
      target: vector3(0, 0, 0),
      fov: safeFov,
      near: 1,
      far: Math.max(backdropRect.distance * 6, 6000),
    },
    world: {
      pixelScale: DEFAULT_SCENE_3D_PIXEL_SCALE,
      gridEnabled: true,
      gridSize: Math.max(backdropRect.width, backdropRect.height),
      gridDivisions: 16,
      showAxes: true,
      showOutputPlane: true,
    },
    items: defaultItems(backdropRect),
  };
};

const mergeVector3 = (
  value: Scene3DVector3 | undefined,
  fallback: Scene3DVector3,
  min = 0,
): Scene3DVector3 => ({
  x: clampPositive(value?.x, fallback.x, min),
  y: clampPositive(value?.y, fallback.y, min),
  z: clampPositive(value?.z, fallback.z, min),
});

const mergeTransform = (
  value: Scene3DItemTransform | undefined,
  fallback: Scene3DItemTransform,
): Scene3DItemTransform => ({
  position: {
    x: numberOrFallback(value?.position?.x, fallback.position.x),
    y: numberOrFallback(value?.position?.y, fallback.position.y),
    z: numberOrFallback(value?.position?.z, fallback.position.z),
  },
  rotation: {
    x: numberOrFallback(value?.rotation?.x, fallback.rotation.x),
    y: numberOrFallback(value?.rotation?.y, fallback.rotation.y),
    z: numberOrFallback(value?.rotation?.z, fallback.rotation.z),
  },
  scale: {
    x: numberOrFallback(value?.scale?.x, fallback.scale.x),
    y: numberOrFallback(value?.scale?.y, fallback.scale.y),
    z: numberOrFallback(value?.scale?.z, fallback.scale.z),
  },
});

const normalizeScene3DAssetReference = (
  asset: Scene3DAssetReference | undefined,
  itemType: Scene3DItem['type'],
): Scene3DAssetReference | undefined => {
  if (!asset) return undefined;
  const storedKind = (asset as Partial<Scene3DAssetReference>).kind;
  const preferredKind =
    storedKind ?? (itemType === 'splat' ? 'splat' : itemType === 'model' ? 'mesh' : undefined);
  return {
    ...asset,
    kind: getScene3DAssetKind(asset.format, preferredKind),
  };
};

const getNormalizedAssetItemType = (
  itemType: Scene3DItem['type'],
  asset: Scene3DAssetReference | undefined,
): Scene3DItem['type'] => {
  if (itemType !== 'model' && itemType !== 'splat') return itemType;
  return asset?.kind === 'splat' ? 'splat' : 'model';
};

const mergeItem = (item: Scene3DItem | undefined, fallback: Scene3DItem): Scene3DItem => {
  const rawType = item?.type ?? fallback.type;
  const asset = normalizeScene3DAssetReference(item?.asset ?? fallback.asset, rawType);

  return {
    ...fallback,
    ...item,
    id: item?.id ?? fallback.id,
    name: item?.name || fallback.name,
    type: getNormalizedAssetItemType(rawType, asset),
    visible: item?.visible ?? fallback.visible,
    locked: fallback.locked || item?.locked,
    transform: mergeTransform(item?.transform, fallback.transform),
    size: mergeVector3(item?.size, fallback.size ?? vector3(1, 1, 1)),
    color: item?.color ?? fallback.color,
    intensity: clampPositive(item?.intensity, fallback.intensity ?? 1, 0),
    asset,
  };
};

export const normalizeScene3DSettings = (
  node: Pick<Scene3DNode, 'scene3d'>,
  canvasSize: Scene3DCanvasSize,
): Scene3DSettings => {
  const fallback = createDefaultScene3DSettings(canvasSize.width, canvasSize.height);
  const source = node.scene3d ?? fallback;
  const fov = clampFov(source.camera?.fov, fallback.camera.fov);
  const backdropDistance = clampPositive(
    source.bounds?.z,
    getScene3DBackdropDistanceForCanvas(canvasSize, fov),
    MIN_SCENE_3D_BACKDROP_DISTANCE,
  );
  const backdropRect = getScene3DBackdropRect({
    canvasSize,
    fov,
    distance: backdropDistance,
  });
  const defaults = createDefaultScene3DSettings(
    canvasSize.width,
    canvasSize.height,
    backdropDistance,
    fov,
  );
  const sourceItemsById = new Map(source.items?.map((item) => [item.id, item]) ?? []);
  const builtInItems = defaults.items.map((item) => mergeItem(sourceItemsById.get(item.id), item));
  const customItems =
    source.items
      ?.filter((item) => !builtInItems.some((builtInItem) => builtInItem.id === item.id))
      .map((item) => mergeItem(item, item)) ?? [];
  const cameraTarget = {
    x: numberOrFallback(source.camera?.target?.x, defaults.camera.target.x),
    y: numberOrFallback(source.camera?.target?.y, defaults.camera.target.y),
    z: numberOrFallback(source.camera?.target?.z, defaults.camera.target.z),
  };
  const rawCameraPosition = {
    x: numberOrFallback(source.camera?.position?.x, defaults.camera.position.x),
    y: numberOrFallback(source.camera?.position?.y, defaults.camera.position.y),
    z: numberOrFallback(source.camera?.position?.z, defaults.camera.position.z),
  };
  const cameraPosition = positionCameraAtDistance(
    rawCameraPosition,
    cameraTarget,
    backdropRect.distance,
  );
  const camera = {
    position: cameraPosition,
    target: cameraTarget,
    fov,
    near: clampPositive(source.camera?.near, defaults.camera.near, 0.01),
    far: Math.max(
      clampPositive(source.camera?.far, defaults.camera.far, 1),
      backdropRect.distance + 1,
    ),
  };
  const items = [...builtInItems, ...customItems].map((item) => {
    if (item.type === 'output_plane') {
      return {
        ...item,
        transform: identityTransform(camera.target),
        size: vector3(backdropRect.width, backdropRect.height, 0),
      };
    }

    if (item.type === 'camera') {
      return {
        ...item,
        transform: {
          ...item.transform,
          position: camera.position,
        },
      };
    }

    return item;
  });

  return {
    bounds: {
      x: backdropRect.width,
      y: backdropRect.height,
      z: backdropRect.distance,
    },
    camera,
    world: {
      pixelScale: clampPositive(source.world?.pixelScale, defaults.world.pixelScale),
      gridEnabled: source.world?.gridEnabled ?? defaults.world.gridEnabled,
      gridSize: clampPositive(source.world?.gridSize, defaults.world.gridSize, 1),
      gridDivisions: Math.max(
        1,
        Math.round(clampPositive(source.world?.gridDivisions, defaults.world.gridDivisions, 1)),
      ),
      showAxes: source.world?.showAxes ?? defaults.world.showAxes,
      showOutputPlane: source.world?.showOutputPlane ?? defaults.world.showOutputPlane,
    },
    items,
  };
};

export const updateScene3DItem = (
  settings: Scene3DSettings,
  itemId: string,
  updater: (item: Scene3DItem) => Scene3DItem,
): Scene3DSettings => ({
  ...settings,
  items: settings.items.map((item) => (item.id === itemId ? updater(item) : item)),
});

export const createScene3DBoxItem = (settings: Scene3DSettings): Scene3DItem => {
  const count = settings.items.filter((item) => item.type === 'box').length + 1;
  return {
    id: createScene3DItemId('scene3d_box'),
    name: `Box ${count}`,
    type: 'box',
    visible: true,
    transform: identityTransform(vector3(0, 0, settings.bounds.z * 0.12)),
    size: vector3(settings.bounds.x * 0.14, settings.bounds.y * 0.14, settings.bounds.z * 0.14),
    color: '#22d3ee',
  };
};

export const createScene3DLightItem = (settings: Scene3DSettings): Scene3DItem => {
  const count = settings.items.filter((item) => item.type === 'light').length + 1;
  return {
    id: createScene3DItemId('scene3d_light'),
    name: `Light ${count}`,
    type: 'light',
    visible: true,
    transform: identityTransform(
      vector3(settings.bounds.x * 0.2, settings.bounds.y * 0.25, settings.bounds.z * 0.7),
    ),
    color: '#fde68a',
    intensity: 2,
  };
};

export const createScene3DAssetItem = (
  settings: Scene3DSettings,
  asset: Scene3DAssetReference,
): Scene3DItem => ({
  id: createScene3DItemId(asset.kind === 'splat' ? 'scene3d_splat' : 'scene3d_model'),
  name: uniqueItemName(settings.items, getBasenameWithoutExtension(asset.fileName)),
  type: asset.kind === 'splat' ? 'splat' : 'model',
  visible: true,
  transform: identityTransform(),
  color: asset.kind === 'splat' ? '#67e8f9' : '#e5e7eb',
  asset,
});
