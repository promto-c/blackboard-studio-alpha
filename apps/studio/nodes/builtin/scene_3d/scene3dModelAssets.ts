import type {
  Scene3DAssetFormat,
  Scene3DAssetKind,
  Scene3DAssetReference,
  Scene3DMeshAssetFormat,
  Scene3DSplatAssetFormat,
} from '@blackboard/types';

export const SCENE_3D_ASSET_ACCEPT = [
  '.glb',
  '.gltf',
  '.obj',
  '.usdz',
  '.stl',
  '.ply',
  '.spz',
  '.splat',
  '.ksplat',
  '.sog',
  '.rad',
  'model/gltf-binary',
  'model/gltf+json',
  'model/vnd.usdz+zip',
].join(',');

const EXTENSION_TO_MESH_FORMAT: Record<string, Scene3DMeshAssetFormat> = {
  glb: 'glb',
  gltf: 'gltf',
  obj: 'obj',
  usdz: 'usdz',
  stl: 'stl',
  ply: 'ply',
};

const EXTENSION_TO_SPLAT_FORMAT: Record<string, Scene3DSplatAssetFormat> = {
  ply: 'ply',
  spz: 'spz',
  splat: 'splat',
  ksplat: 'ksplat',
  sog: 'sog',
  rad: 'rad',
};

const SPLAT_FORMATS = new Set<Scene3DAssetFormat>(Object.values(EXTENSION_TO_SPLAT_FORMAT));
const PLY_HEADER_SCAN_BYTES = 128 * 1024;
const GAUSSIAN_PLY_HEADER_MARKERS = [
  'property float scale_0',
  'property double scale_0',
  'property float rot_0',
  'property double rot_0',
  'property float f_dc_0',
  'property double f_dc_0',
  'property uint packed_position',
  'property uint packed_rotation',
  'property uint packed_scale',
  'property uint packed_color',
];

export const getScene3DAssetFormat = (fileName: string): Scene3DAssetFormat | null => {
  const extension = fileName.trim().split('.').pop()?.toLowerCase();
  if (!extension) return null;
  return EXTENSION_TO_SPLAT_FORMAT[extension] ?? EXTENSION_TO_MESH_FORMAT[extension] ?? null;
};

export const getScene3DAssetKind = (
  format: Scene3DAssetFormat,
  preferredKind?: Scene3DAssetKind,
): Scene3DAssetKind => {
  if (format === 'ply' && preferredKind) return preferredKind;
  return SPLAT_FORMATS.has(format) ? 'splat' : 'mesh';
};

export const inferScene3DAssetKind = async (
  file: File,
  format: Scene3DAssetFormat,
): Promise<Scene3DAssetKind> => {
  if (format !== 'ply') return getScene3DAssetKind(format);

  const headerBytes = await file.slice(0, PLY_HEADER_SCAN_BYTES).arrayBuffer();
  const text = new TextDecoder().decode(headerBytes).toLowerCase();
  const headerEnd = text.indexOf('end_header');
  const header = headerEnd >= 0 ? text.slice(0, headerEnd) : text;
  return GAUSSIAN_PLY_HEADER_MARKERS.some((marker) => header.includes(marker)) ? 'splat' : 'mesh';
};

export const createScene3DAssetReference = (
  file: File,
  assetId: string,
  preferredKind?: Scene3DAssetKind,
): Scene3DAssetReference | null => {
  const format = getScene3DAssetFormat(file.name);
  if (!format) return null;

  return {
    assetId,
    fileName: file.name,
    kind: getScene3DAssetKind(format, preferredKind),
    format,
    mimeType: file.type || undefined,
    size: file.size,
  };
};

export const isScene3DAssetFile = (file: File): boolean =>
  getScene3DAssetFormat(file.name) !== null;
