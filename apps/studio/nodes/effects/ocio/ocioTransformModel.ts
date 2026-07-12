import {
  OCIO_COMPOSITING_LOG_SPACE,
  OCIO_PROJECT_WORKING_SPACE,
  OCIO_TEXTURE_COLOR_SPACE,
  type ColorProcessingDomain,
  type OcioColorSpaceTransformNode,
  type OcioFileTransformNode,
  type OcioLookTransformNode,
  type OcioNamedTransformNode,
  type OcioTransformColorSpace,
} from '@blackboard/types';
import type {
  RendererOcioTransformContext,
  RendererOcioTransformDescriptor,
} from '@blackboard/renderer';

export const resolveOcioTransformColorSpace = (
  colorSpace: OcioTransformColorSpace,
  context: RendererOcioTransformContext,
): string => {
  if (colorSpace === OCIO_PROJECT_WORKING_SPACE) return context.workingColorSpace;
  if (colorSpace === OCIO_TEXTURE_COLOR_SPACE) return context.textureColorSpace;
  if (colorSpace === OCIO_COMPOSITING_LOG_SPACE) {
    if (!context.logColorSpace) {
      throw new Error('The active OCIO config does not define the compositing_log role.');
    }
    return context.logColorSpace;
  }
  return colorSpace;
};

const colorSpaceTransform = (
  source: string,
  destination: string,
): RendererOcioTransformDescriptor[] =>
  source === destination ? [] : [{ type: 'colorSpace', source, destination }];

export const getColorSpaceNodeTransforms = (
  node: OcioColorSpaceTransformNode,
  context: RendererOcioTransformContext,
): RendererOcioTransformDescriptor[] => {
  const source = resolveOcioTransformColorSpace(node.sourceColorSpace, context);
  const destination = resolveOcioTransformColorSpace(node.destinationColorSpace, context);
  return colorSpaceTransform(source, destination);
};

export interface OcioColorSpaceDomainContext {
  workingColorSpace: string;
  textureColorSpace: string;
  logColorSpace?: string;
  colorSpaces: readonly {
    name: string;
    canonicalName?: string | null;
    aliases: readonly string[];
    encoding: string;
    isData: boolean;
  }[];
}

export const getOcioColorSpaceProcessingDomain = (
  value: OcioTransformColorSpace,
  context: OcioColorSpaceDomainContext,
): ColorProcessingDomain => {
  if (value === OCIO_PROJECT_WORKING_SPACE) return 'scene_linear';
  if (value === OCIO_COMPOSITING_LOG_SPACE) return 'log';
  if (value === OCIO_TEXTURE_COLOR_SPACE) return 'display_referred';

  const normalizedValue = value.trim().toLowerCase();
  const colorSpace = context.colorSpaces.find(
    (candidate) =>
      candidate.name.toLowerCase() === normalizedValue ||
      candidate.canonicalName?.toLowerCase() === normalizedValue ||
      candidate.aliases.some((alias) => alias.toLowerCase() === normalizedValue),
  );
  if (colorSpace?.isData) return 'data';

  const canonicalName = colorSpace?.canonicalName || colorSpace?.name || value;
  if (canonicalName === context.workingColorSpace) return 'scene_linear';
  if (context.logColorSpace && canonicalName === context.logColorSpace) return 'log';

  const encoding = colorSpace?.encoding.trim().toLowerCase() ?? '';
  if (encoding.includes('log')) return 'log';
  if (
    encoding === 'linear' ||
    encoding.includes('scene-linear') ||
    encoding.includes('scene linear')
  ) {
    return 'scene_linear';
  }
  return 'display_referred';
};

export const getNamedTransformNodeTransforms = (
  node: OcioNamedTransformNode,
  context: RendererOcioTransformContext,
): RendererOcioTransformDescriptor[] => {
  if (!node.namedTransform.trim()) return [];
  const processColorSpace = resolveOcioTransformColorSpace(node.processColorSpace, context);
  return [
    ...colorSpaceTransform(context.workingColorSpace, processColorSpace),
    { type: 'named', name: node.namedTransform, direction: node.direction },
    ...colorSpaceTransform(processColorSpace, context.workingColorSpace),
  ];
};

export const getFileTransformNodeTransforms = (
  node: OcioFileTransformNode,
  context: RendererOcioTransformContext,
): RendererOcioTransformDescriptor[] => {
  if (!node.assetId) return [];
  const { entryColorSpace, exitColorSpace } = getFileTransformColorSpaces(node, context);
  return [
    ...colorSpaceTransform(context.workingColorSpace, entryColorSpace),
    {
      type: 'file',
      assetId: node.assetId,
      direction: node.direction,
      interpolation: node.interpolation,
      ...(node.cccId?.trim() ? { cccId: node.cccId.trim() } : {}),
    },
    ...colorSpaceTransform(exitColorSpace, context.workingColorSpace),
  ];
};

export const getFileTransformColorSpaces = (
  node: Pick<OcioFileTransformNode, 'direction' | 'inputColorSpace' | 'outputColorSpace'>,
  context: RendererOcioTransformContext,
): { entryColorSpace: string; exitColorSpace: string } => {
  const inputColorSpace = resolveOcioTransformColorSpace(node.inputColorSpace, context);
  const outputColorSpace = resolveOcioTransformColorSpace(node.outputColorSpace, context);
  return node.direction === 'inverse'
    ? { entryColorSpace: outputColorSpace, exitColorSpace: inputColorSpace }
    : { entryColorSpace: inputColorSpace, exitColorSpace: outputColorSpace };
};

export const getLookTransformNodeTransforms = (
  node: OcioLookTransformNode,
  context: RendererOcioTransformContext,
): RendererOcioTransformDescriptor[] =>
  node.looks.trim()
    ? [
        {
          type: 'look',
          source: context.workingColorSpace,
          destination: context.workingColorSpace,
          looks: node.looks,
          direction: node.direction,
        },
      ]
    : [];

export const getOcioRoleLabel = (value: OcioTransformColorSpace): string | null => {
  if (value === OCIO_PROJECT_WORKING_SPACE) return 'Project Working';
  if (value === OCIO_TEXTURE_COLOR_SPACE) return 'Texture / Paint';
  if (value === OCIO_COMPOSITING_LOG_SPACE) return 'Compositing Log';
  return null;
};
