import { deepClone } from '@/utils/deepClone';
import { getNonEmptyString, isJsonObject } from '@/utils/guards';

export interface ComfyClipboardWorkflow extends Record<string, unknown> {
  nodes: Record<string, unknown>[];
  links: unknown[];
}

interface ComfyClipboardItems {
  nodes: Record<string, unknown>[];
  groups: unknown[];
  reroutes: unknown[];
  links: unknown[];
  subgraphs: unknown[];
}

interface ComfyClipboardLink {
  id: string | number;
  originId: string | number;
  originSlot: number;
  targetId: string | number;
  targetSlot: number;
}

const COMFY_CLIPBOARD_METADATA_PATTERN = /data-metadata="([A-Za-z0-9+/=]+)"/;

const isNodeId = (value: unknown): value is string | number =>
  typeof value === 'string' || typeof value === 'number';

const isComfyClipboardNode = (value: unknown): value is Record<string, unknown> =>
  isJsonObject(value) && isNodeId(value.id) && getNonEmptyString(value.type) !== undefined;

const getComfyClipboardItems = (value: unknown): ComfyClipboardItems | null => {
  if (
    !isJsonObject(value) ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.groups) ||
    !Array.isArray(value.reroutes) ||
    !Array.isArray(value.links) ||
    !Array.isArray(value.subgraphs) ||
    value.nodes.length === 0 ||
    !value.nodes.every(isComfyClipboardNode)
  ) {
    return null;
  }

  return {
    nodes: value.nodes,
    groups: value.groups,
    reroutes: value.reroutes,
    links: value.links,
    subgraphs: value.subgraphs,
  };
};

const getComfyClipboardLink = (value: unknown): ComfyClipboardLink | null => {
  if (Array.isArray(value)) {
    const [id, originId, originSlot, targetId, targetSlot] = value;
    return isNodeId(id) &&
      isNodeId(originId) &&
      typeof originSlot === 'number' &&
      isNodeId(targetId) &&
      typeof targetSlot === 'number'
      ? { id, originId, originSlot, targetId, targetSlot }
      : null;
  }

  if (!isJsonObject(value)) return null;
  const {
    id,
    origin_id: originId,
    origin_slot: originSlot,
    target_id: targetId,
    target_slot: targetSlot,
  } = value;
  return isNodeId(id) &&
    isNodeId(originId) &&
    typeof originSlot === 'number' &&
    isNodeId(targetId) &&
    typeof targetSlot === 'number'
    ? { id, originId, originSlot, targetId, targetSlot }
    : null;
};

const getMaxNumericId = (values: Iterable<unknown>): number => {
  let max = 0;
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      max = Math.max(max, value);
    }
  }
  return max;
};

const sanitizeComfyClipboardNode = (
  node: Record<string, unknown>,
  internalLinkIds: Set<string>,
): Record<string, unknown> => {
  const cloned = deepClone(node);

  if (Array.isArray(cloned.inputs)) {
    cloned.inputs = cloned.inputs.map((input) => {
      if (!isJsonObject(input) || input.link == null) return input;
      return internalLinkIds.has(String(input.link)) ? input : { ...input, link: null };
    });
  }

  if (Array.isArray(cloned.outputs)) {
    cloned.outputs = cloned.outputs.map((output) => {
      if (!isJsonObject(output) || !Array.isArray(output.links)) return output;
      return {
        ...output,
        links: output.links.filter((linkId) => internalLinkIds.has(String(linkId))),
      };
    });
  }

  return cloned;
};

const sanitizeComfyClipboardReroute = (reroute: unknown, internalLinkIds: Set<string>): unknown => {
  if (!isJsonObject(reroute) || !Array.isArray(reroute.linkIds)) return deepClone(reroute);
  return {
    ...deepClone(reroute),
    linkIds: reroute.linkIds.filter((linkId) => internalLinkIds.has(String(linkId))),
  };
};

const getComfyClipboardWorkflowName = (nodes: Record<string, unknown>[]): string => {
  if (nodes.length !== 1) return `Pasted Comfy Selection (${nodes.length} nodes)`;
  const nodeName = getNonEmptyString(nodes[0].title) ?? getNonEmptyString(nodes[0].type);
  return nodeName ? `Pasted ${nodeName}` : 'Pasted Comfy Node';
};

export const createComfyWorkflowFromClipboardItems = (
  value: unknown,
): ComfyClipboardWorkflow | null => {
  const items = getComfyClipboardItems(value);
  if (!items) return null;

  const nodeIds = new Set(items.nodes.map((node) => String(node.id)));
  const internalLinks = items.links.filter((link) => {
    const parsed = getComfyClipboardLink(link);
    return (
      parsed !== null &&
      nodeIds.has(String(parsed.originId)) &&
      nodeIds.has(String(parsed.targetId))
    );
  });
  const internalLinkIds = new Set(
    internalLinks
      .map(getComfyClipboardLink)
      .filter((link): link is ComfyClipboardLink => link !== null)
      .map((link) => String(link.id)),
  );
  const nodes = items.nodes.map((node) => sanitizeComfyClipboardNode(node, internalLinkIds));
  const reroutes = items.reroutes.map((reroute) =>
    sanitizeComfyClipboardReroute(reroute, internalLinkIds),
  );

  return {
    revision: 0,
    last_node_id: getMaxNumericId(nodes.map((node) => node.id)),
    last_link_id: getMaxNumericId(internalLinks.map((link) => getComfyClipboardLink(link)?.id)),
    nodes,
    links: deepClone(internalLinks),
    groups: deepClone(items.groups),
    config: {},
    definitions: { subgraphs: deepClone(items.subgraphs) },
    extra: { reroutes },
    version: 0.4,
    name: getComfyClipboardWorkflowName(nodes),
  };
};

export const parseComfyClipboardText = (text: string): ComfyClipboardWorkflow | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return createComfyWorkflowFromClipboardItems(JSON.parse(trimmed) as unknown);
  } catch {
    return null;
  }
};

export const parseComfyClipboardHtml = (html: string): ComfyClipboardWorkflow | null => {
  const encoded = html.match(COMFY_CLIPBOARD_METADATA_PATTERN)?.[1];
  if (!encoded) return null;

  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return parseComfyClipboardText(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
};
