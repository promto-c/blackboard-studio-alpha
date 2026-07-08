import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { USDZLoader } from 'three/examples/jsm/loaders/USDZLoader.js';
import type { Scene3DItem } from '@blackboard/types';
import {
  applyScene3DSplatImportOrientation,
  createScene3DGeometryObject,
  isScene3DSplatItem,
  prepareScene3DLoadedObject,
  type Scene3DColorTransform,
} from './scene3dRenderer';

export type Scene3DSplatRuntimeModule = typeof import('./scene3dSplatRuntime');
export type LoadScene3DSplatRuntime = () => Promise<Scene3DSplatRuntimeModule>;

export interface LoadedScene3DAssetObject {
  object: THREE.Object3D;
  usesSplatRenderer: boolean;
}

const loadScene3DMeshAssetObject = async (
  item: Scene3DItem,
  objectUrl: string,
  transformColorPickingToSceneLinear: Scene3DColorTransform,
): Promise<THREE.Object3D> => {
  switch (item.asset?.format) {
    case 'glb':
    case 'gltf': {
      const result = await new GLTFLoader().loadAsync(objectUrl);
      return prepareScene3DLoadedObject(result.scene, item, transformColorPickingToSceneLinear);
    }
    case 'obj': {
      const result = await new OBJLoader().loadAsync(objectUrl);
      return prepareScene3DLoadedObject(result, item, transformColorPickingToSceneLinear);
    }
    case 'fbx': {
      const result = await new FBXLoader().loadAsync(objectUrl);
      return prepareScene3DLoadedObject(result, item, transformColorPickingToSceneLinear);
    }
    case 'usdz': {
      const result = await new USDZLoader().loadAsync(objectUrl);
      return prepareScene3DLoadedObject(result, item, transformColorPickingToSceneLinear);
    }
    case 'stl': {
      const geometry = await new STLLoader().loadAsync(objectUrl);
      return createScene3DGeometryObject(geometry, item, transformColorPickingToSceneLinear);
    }
    case 'ply': {
      const geometry = await new PLYLoader().loadAsync(objectUrl);
      return createScene3DGeometryObject(geometry, item, transformColorPickingToSceneLinear);
    }
    default:
      throw new Error('Unsupported 3D asset format.');
  }
};

export const loadScene3DAssetObject = async (
  item: Scene3DItem,
  blob: Blob,
  loadSplatRuntime: LoadScene3DSplatRuntime,
  transformColorPickingToSceneLinear: Scene3DColorTransform,
): Promise<LoadedScene3DAssetObject> => {
  if (isScene3DSplatItem(item)) {
    try {
      const runtime = await loadSplatRuntime();
      return {
        object: applyScene3DSplatImportOrientation(
          await runtime.loadScene3DSplatAssetObject(item, blob),
        ),
        usesSplatRenderer: true,
      };
    } catch (error) {
      if (item.asset?.format !== 'ply') throw error;
      console.warn('Failed to load PLY as a Gaussian splat; falling back to mesh loading.', error);
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    return {
      object: await loadScene3DMeshAssetObject(item, objectUrl, transformColorPickingToSceneLinear),
      usesSplatRenderer: false,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};
