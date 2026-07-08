import { colorManagementService } from './service';
import type { ColorManagementService, ResolvedProjectColorManagement } from './types';

type RgbColor = readonly [number, number, number];
type RgbaColor = readonly [number, number, number, number];
type GeneratedColorRoles = Pick<
  ResolvedProjectColorManagement,
  'colorPickingColorSpace' | 'workingColorSpace' | 'context'
>;

export function convertColorPickingToSceneLinear(
  color: RgbColor,
  roles: GeneratedColorRoles,
  service?: Pick<ColorManagementService, 'transformRgb'>,
): [number, number, number];
export function convertColorPickingToSceneLinear(
  color: RgbaColor,
  roles: GeneratedColorRoles,
  service?: Pick<ColorManagementService, 'transformRgb'>,
): [number, number, number, number];
export function convertColorPickingToSceneLinear(
  color: RgbColor | RgbaColor,
  roles: GeneratedColorRoles,
  service: Pick<ColorManagementService, 'transformRgb'> = colorManagementService,
): [number, number, number] | [number, number, number, number] {
  const rgb = service.transformRgb(
    roles.colorPickingColorSpace,
    roles.workingColorSpace,
    [color[0], color[1], color[2]],
    roles.context,
  );
  return color.length === 4 ? [...rgb, color[3]] : rgb;
}
