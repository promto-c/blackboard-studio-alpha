import type { RequiredOcioRole } from '@blackboard/types';

export type { RequiredOcioRole };

export interface ColorSpaceReference {
  name: string;
  canonicalName?: string | null;
}

export interface ColorRoleReference {
  name: string;
  colorSpace: string;
}

export interface ResolvedColorRoles {
  sceneLinear: string;
  texturePaint: string;
  colorPicking: string;
  data: string;
}

export interface OptionalColorRoleIssue {
  name: string;
  colorSpace: string | null;
  message: string;
}

const REQUIRED_ROLES: readonly RequiredOcioRole[] = [
  'scene_linear',
  'texture_paint',
  'color_picking',
  'data',
];

const STUDIO_OPTIONAL_ROLES = new Set(['compositing_log']);

export const resolveCanonicalColorSpaceName = (
  colorSpaces: readonly ColorSpaceReference[],
  colorSpaceName: string | undefined | null,
): string | null => {
  const trimmed = colorSpaceName?.trim();
  if (!trimmed) return null;

  const colorSpace = colorSpaces.find(
    (candidate) => candidate.name === trimmed || candidate.canonicalName === trimmed,
  );
  return colorSpace?.canonicalName || colorSpace?.name || null;
};

export const resolveRequiredRoleColorSpace = (
  roles: readonly ColorRoleReference[],
  colorSpaces: readonly ColorSpaceReference[],
  roleName: RequiredOcioRole,
  roleOverrides: Partial<Record<RequiredOcioRole, string>> = {},
): string => {
  const override = roleOverrides[roleName]?.trim();
  if (override) {
    const canonicalOverride = resolveCanonicalColorSpaceName(colorSpaces, override);
    if (!canonicalOverride) {
      throw new Error(
        `Project OCIO role override "${roleName}" references missing color space "${override}".`,
      );
    }
    return canonicalOverride;
  }

  const role = roles.find((candidate) => candidate.name === roleName);
  if (!role?.colorSpace) {
    throw new Error(`Required OCIO role "${roleName}" is not defined by the active config.`);
  }

  const canonicalName = resolveCanonicalColorSpaceName(colorSpaces, role.colorSpace);
  if (!canonicalName) {
    throw new Error(
      `Required OCIO role "${roleName}" references missing color space "${role.colorSpace}".`,
    );
  }

  return canonicalName;
};

export const resolveRequiredColorRoles = (
  roles: readonly ColorRoleReference[],
  colorSpaces: readonly ColorSpaceReference[],
  roleOverrides: Partial<Record<RequiredOcioRole, string>> = {},
): ResolvedColorRoles => {
  const resolved = Object.fromEntries(
    REQUIRED_ROLES.map((roleName) => [
      roleName,
      resolveRequiredRoleColorSpace(roles, colorSpaces, roleName, roleOverrides),
    ]),
  ) as Record<RequiredOcioRole, string>;

  return {
    sceneLinear: resolved.scene_linear,
    texturePaint: resolved.texture_paint,
    colorPicking: resolved.color_picking,
    data: resolved.data,
  };
};

export const getUnavailableOptionalRoles = (
  roles: readonly ColorRoleReference[],
  colorSpaces: readonly ColorSpaceReference[],
): OptionalColorRoleIssue[] =>
  roles.flatMap((role) => {
    const roleName = role.name.trim();
    if (
      !roleName ||
      REQUIRED_ROLES.includes(roleName as RequiredOcioRole) ||
      !STUDIO_OPTIONAL_ROLES.has(roleName)
    ) {
      return [];
    }

    const colorSpaceName = role.colorSpace?.trim();
    if (!colorSpaceName) {
      return [
        {
          name: roleName,
          colorSpace: null,
          message: `Optional OCIO role "${roleName}" does not define a color space.`,
        },
      ];
    }

    if (resolveCanonicalColorSpaceName(colorSpaces, colorSpaceName)) {
      return [];
    }

    return [
      {
        name: roleName,
        colorSpace: colorSpaceName,
        message: `Optional OCIO role "${roleName}" references missing color space "${colorSpaceName}".`,
      },
    ];
  });
