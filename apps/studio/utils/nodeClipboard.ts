import type { AnyNode, Flow, FlowEdge, FlowId, NodePositions } from '@blackboard/types';
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

const parseNodeClipboardText = (text: string): NodeClipboardPayload | null => {
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

export const readNodeClipboard = async (): Promise<NodeClipboardPayload | null> => {
  let readSystemClipboard = false;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
    try {
      const text = await navigator.clipboard.readText();
      readSystemClipboard = true;
      const payload = parseNodeClipboardText(text);
      if (payload) {
        writeItemsClipboard({
          kind: NODE_CLIPBOARD_KIND,
          version: NODE_CLIPBOARD_VERSION,
          payload,
        });
        return payload;
      }
    } catch (error) {
      console.warn('Could not read nodes from the system clipboard', error);
    }
  }

  if (readSystemClipboard) {
    return null;
  }

  const memoryRecord = readItemsClipboard<typeof NODE_CLIPBOARD_KIND, NodeClipboardPayload>(
    NODE_CLIPBOARD_KIND,
  );
  return memoryRecord ? deepClone(memoryRecord.payload) : null;
};
