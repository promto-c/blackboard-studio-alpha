import type { AnyNode, Flow, FlowEdge, FlowId, NodePositions } from '@blackboard/types';
import {
  parseComfyClipboardHtml,
  parseComfyClipboardText,
  type ComfyClipboardWorkflow,
} from '@/services/comfy/clipboard';
import { readItemsClipboard, writeItemsClipboard } from '@/utils/itemsClipboard';
import { deepClone } from '@/utils/deepClone';

export const NODE_CLIPBOARD_KIND = 'blackboard-studio.nodes';
export const NODE_CLIPBOARD_VERSION = 1;

export interface NodeClipboardPayload {
  kind: typeof NODE_CLIPBOARD_KIND;
  version: typeof NODE_CLIPBOARD_VERSION;
  createdAt: number;
  nodes: AnyNode[];
  edges: FlowEdge[];
  flows: Record<FlowId, Flow>;
  nodePositionsByFlow: Record<FlowId, NodePositions>;
  sourceFlowId: FlowId | null;
  selectedNodeIds: string[];
}

interface NodeClipboardRecord {
  kind: typeof NODE_CLIPBOARD_KIND;
  version: typeof NODE_CLIPBOARD_VERSION;
  payload: NodeClipboardPayload;
}

export type NodeClipboardReadResult =
  | { source: 'blackboard'; payload: NodeClipboardPayload }
  | { source: 'comfy'; workflow: ComfyClipboardWorkflow };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNodeClipboardPayload = (value: unknown): value is NodeClipboardPayload => {
  if (!isRecord(value)) return false;
  return (
    value.kind === NODE_CLIPBOARD_KIND &&
    value.version === NODE_CLIPBOARD_VERSION &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.edges) &&
    isRecord(value.flows) &&
    isRecord(value.nodePositionsByFlow) &&
    Array.isArray(value.selectedNodeIds)
  );
};

const serializeNodeClipboardPayload = (payload: NodeClipboardPayload): string =>
  JSON.stringify(
    {
      kind: NODE_CLIPBOARD_KIND,
      version: NODE_CLIPBOARD_VERSION,
      payload,
    } satisfies NodeClipboardRecord,
    null,
    2,
  );

export const parseNodeClipboardText = (text: string): NodeClipboardPayload | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isNodeClipboardPayload(parsed)) {
      return deepClone(parsed);
    }

    if (isRecord(parsed) && parsed.kind === NODE_CLIPBOARD_KIND) {
      const payload = parsed.payload;
      if (isNodeClipboardPayload(payload)) {
        return deepClone(payload);
      }
    }
  } catch {
    return null;
  }

  return null;
};

export const createNodeClipboardPayloadForImport = (nodes: AnyNode[]): NodeClipboardPayload => {
  const sourceFlowId = 'clipboard_import';
  return {
    kind: NODE_CLIPBOARD_KIND,
    version: NODE_CLIPBOARD_VERSION,
    createdAt: Date.now(),
    nodes: deepClone(nodes),
    edges: [],
    flows: {},
    nodePositionsByFlow: {
      [sourceFlowId]: Object.fromEntries(
        nodes.map((node, index) => [node.id, { x: 0, y: index * 96 }]),
      ),
    },
    sourceFlowId,
    selectedNodeIds: nodes.map((node) => node.id),
  };
};

export const writeNodeClipboard = async (payload: NodeClipboardPayload): Promise<boolean> => {
  const payloadCopy = deepClone(payload);
  writeItemsClipboard({
    kind: NODE_CLIPBOARD_KIND,
    version: NODE_CLIPBOARD_VERSION,
    payload: payloadCopy,
  });

  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return true;
  }

  try {
    await navigator.clipboard.writeText(serializeNodeClipboardPayload(payloadCopy));
    return true;
  } catch (error) {
    console.warn('Could not write nodes to the system clipboard', error);
    return true;
  }
};

const cacheBlackboardClipboardPayload = (
  payload: NodeClipboardPayload,
): NodeClipboardReadResult => {
  writeItemsClipboard({
    kind: NODE_CLIPBOARD_KIND,
    version: NODE_CLIPBOARD_VERSION,
    payload,
  });
  return { source: 'blackboard', payload };
};

const parseClipboardRepresentations = ({
  html,
  text,
}: {
  html?: string;
  text?: string;
}): NodeClipboardReadResult | null => {
  if (text) {
    const payload = parseNodeClipboardText(text);
    if (payload) return cacheBlackboardClipboardPayload(payload);
  }

  const comfyWorkflow =
    (html ? parseComfyClipboardHtml(html) : null) ?? (text ? parseComfyClipboardText(text) : null);
  return comfyWorkflow ? { source: 'comfy', workflow: comfyWorkflow } : null;
};

const readClipboardItemType = async (item: ClipboardItem, type: string): Promise<string> => {
  const blob = await item.getType(type);
  return blob.text();
};

export const readNodeClipboard = async (): Promise<NodeClipboardReadResult | null> => {
  let readSystemClipboard = false;
  let clipboardReadError: unknown;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.read) {
    try {
      const items = await navigator.clipboard.read();
      readSystemClipboard = true;
      let html: string | undefined;
      let text: string | undefined;

      for (const item of items) {
        if (html === undefined && item.types.includes('text/html')) {
          html = await readClipboardItemType(item, 'text/html');
        }
        if (text === undefined && item.types.includes('text/plain')) {
          text = await readClipboardItemType(item, 'text/plain');
        }
      }

      return parseClipboardRepresentations({ html, text });
    } catch (error) {
      clipboardReadError = error;
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
    try {
      const text = await navigator.clipboard.readText();
      readSystemClipboard = true;
      return parseClipboardRepresentations({ text });
    } catch (error) {
      clipboardReadError = error;
    }
  }

  if (clipboardReadError) {
    console.warn('Could not read nodes from the system clipboard', clipboardReadError);
  }
  if (readSystemClipboard) return null;

  const memoryRecord = readItemsClipboard<typeof NODE_CLIPBOARD_KIND, NodeClipboardPayload>(
    NODE_CLIPBOARD_KIND,
  );
  return memoryRecord ? { source: 'blackboard', payload: deepClone(memoryRecord.payload) } : null;
};
