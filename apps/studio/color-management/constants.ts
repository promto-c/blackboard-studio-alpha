export const ColorManagementDefaults = {
  CONFIG: 'ocio://cg-config-v4.0.0_aces-v2.0_ocio-v2.5',
  DISPLAY: 'sRGB - Display',
  VIEW: 'ACES 2.0 - SDR 100 nits (Rec.709)',
  WORKING_SPACE: 'ACEScg',
  TEXTURE_SPACE: 'sRGB Encoded Rec.709 (sRGB)',
  COLOR_PICKING_SPACE: 'sRGB Encoded Rec.709 (sRGB)',
  DATA_SPACE: 'Raw',
} as const;

export type FinalCanvasColorSpace = 'raw_texture' | 'scene_linear' | 'srgb' | 'match_viewport';

export const isSceneLinearColorSpace = (
  colorSpace: string | undefined | null,
  workingColorSpace: string,
): boolean => colorSpace?.trim() === workingColorSpace.trim();

export const getScenePreviewColorSpace = (
  sceneColorSpace: string | undefined | null,
  workingColorSpace: string,
): FinalCanvasColorSpace =>
  isSceneLinearColorSpace(sceneColorSpace, workingColorSpace) ? 'srgb' : 'raw_texture';
