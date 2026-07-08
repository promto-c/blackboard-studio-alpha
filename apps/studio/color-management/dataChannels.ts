import type { DataChannelSemantic } from '@blackboard/types';

export type { DataChannelSemantic } from '@blackboard/types';

export type DataChannelClassification = {
  isData: boolean;
  semantic: DataChannelSemantic | null;
};

type DataChannelRule = {
  semantic: DataChannelSemantic;
  matches: readonly RegExp[];
};

const tokenBoundary = String.raw`(?:^|[._\s:/-])`;
const tokenEnd = String.raw`(?:$|[._\s:/-])`;

const DATA_CHANNEL_RULES: readonly DataChannelRule[] = [
  {
    semantic: 'cryptomatte',
    matches: [/^crypto(?:matte)?/, /cryptomatte/, /crypto(?:object|material|asset)/],
  },
  {
    semantic: 'alpha',
    matches: [/^(?:a|alpha|opacity)$/, new RegExp(`${tokenBoundary}(?:alpha|opacity)${tokenEnd}`)],
  },
  {
    semantic: 'mask',
    matches: [new RegExp(`${tokenBoundary}(?:mask|matte|holdout|stencil)${tokenEnd}`)],
  },
  {
    semantic: 'normal',
    matches: [
      /^(?:n|nx|ny|nz|normal|normals)$/,
      new RegExp(`${tokenBoundary}(?:n|normal|normals)${tokenEnd}`),
    ],
  },
  {
    semantic: 'depth',
    matches: [/^(?:z|depth|zdepth)$/, new RegExp(`${tokenBoundary}(?:z|depth|zdepth)${tokenEnd}`)],
  },
  {
    semantic: 'motion_vector',
    matches: [
      new RegExp(`${tokenBoundary}(?:motion|motionvector|velocity|vector|flow)${tokenEnd}`),
      /^(?:mv|motionvector|velocity|flow)(?:[xyzuv])?$/,
    ],
  },
  {
    semantic: 'uv',
    matches: [/^(?:uv|st|u|v)$/, new RegExp(`${tokenBoundary}(?:uv|st)${tokenEnd}`)],
  },
  {
    semantic: 'position',
    matches: [
      /^(?:p|px|py|pz|position|worldposition)$/,
      new RegExp(`${tokenBoundary}(?:p|position|worldposition)${tokenEnd}`),
    ],
  },
  {
    semantic: 'id',
    matches: [
      new RegExp(`${tokenBoundary}(?:id|objectid|materialid|object_id|material_id)${tokenEnd}`),
      /^(?:id|objectid|materialid|object_id|material_id)$/,
    ],
  },
  {
    semantic: 'material_property',
    matches: [
      new RegExp(`${tokenBoundary}(?:roughness|metallic|metalness|displacement)${tokenEnd}`),
      /^(?:roughness|metallic|metalness|displacement)$/,
    ],
  },
];

const normalizeChannelName = (channelName: string): string =>
  channelName.trim().toLowerCase().replace(/\s+/g, '_');

export const classifyDataChannel = (
  channelName: string | null | undefined,
): DataChannelClassification => {
  const normalized = normalizeChannelName(channelName ?? '');
  if (!normalized) return { isData: false, semantic: null };

  const compact = normalized.replace(/[^a-z0-9]+/g, '');
  const rule = DATA_CHANNEL_RULES.find((candidate) =>
    candidate.matches.some((pattern) => pattern.test(normalized) || pattern.test(compact)),
  );

  return rule ? { isData: true, semantic: rule.semantic } : { isData: false, semantic: null };
};

export const isDataChannel = (channelName: string | null | undefined): boolean =>
  classifyDataChannel(channelName).isData;
