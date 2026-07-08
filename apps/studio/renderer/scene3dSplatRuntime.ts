import type { Object3D, WebGLRenderer } from 'three';
import { SparkRenderer, SplatFileType, SplatMesh, getSplatFileType } from '@sparkjsdev/spark';
import type { Scene3DAssetFormat, Scene3DItem } from '@blackboard/types';

const SPLAT_FILE_TYPE_BY_FORMAT: Partial<Record<Scene3DAssetFormat, SplatFileType>> = {
  ply: SplatFileType.PLY,
  spz: SplatFileType.SPZ,
  splat: SplatFileType.SPLAT,
  ksplat: SplatFileType.KSPLAT,
  sog: SplatFileType.PCSOGSZIP,
  rad: SplatFileType.RAD,
};

const getSparkSplatFileType = (
  format: Scene3DAssetFormat | undefined,
  fileBytes: Uint8Array,
): SplatFileType | undefined =>
  (format ? SPLAT_FILE_TYPE_BY_FORMAT[format] : undefined) ?? getSplatFileType(fileBytes);

export const createScene3DSplatRenderer = (
  renderer: WebGLRenderer,
  onDirty?: () => void,
): Object3D => new SparkRenderer({ renderer, onDirty }) as unknown as Object3D;

export const loadScene3DSplatAssetObject = async (
  item: Scene3DItem,
  blob: Blob,
): Promise<Object3D> => {
  const fileBytes = new Uint8Array(await blob.arrayBuffer());
  const fileType = getSparkSplatFileType(item.asset?.format, fileBytes);
  const mesh = new SplatMesh({
    fileBytes,
    fileType,
    fileName: item.asset?.fileName,
  });
  await mesh.initialized;
  return mesh as unknown as Object3D;
};
