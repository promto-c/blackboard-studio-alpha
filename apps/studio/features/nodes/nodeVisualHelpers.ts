import { AnyNode, BlendMode } from '@blackboard/types';
import { getNodeAssetIds, nodeFlags } from '@/effects/effectHelpers';

export const getBlendModeLabel = (mode?: BlendMode): string => {
  if (!mode) return 'Over';

  switch (mode) {
    case BlendMode.OVER:
      return 'Over';
    case BlendMode.ADD:
      return 'Add';
    case BlendMode.MULTIPLY:
      return 'Mult';
    case BlendMode.SCREEN:
      return 'Scrn';
    default:
      return 'Over';
  }
};

export const getNodeBlendModeLabel = (node: AnyNode): string =>
  getBlendModeLabel((node as { operator?: BlendMode }).operator);

export const hasMediaThumbnail = (node: AnyNode): boolean => !!nodeFlags(node.type).hasThumbnail;

export const getStaticThumbnailAssetId = (node: AnyNode): string => {
  const assetIds = getNodeAssetIds(node);
  return assetIds[0] ?? '';
};
