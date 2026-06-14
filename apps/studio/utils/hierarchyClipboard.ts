import { createUniqueItemNameAssigner } from '@/utils/uniqueItemName';
import { readItemsClipboard, writeItemsClipboard } from '@/utils/itemsClipboard';

// ---------------------------------------------------------------------------
// Shared clipboard tree item shapes
// ---------------------------------------------------------------------------

interface ClipboardTreeLayer<TLayer> {
  type: 'layer';
  layer: TLayer;
  children: ClipboardTreeItem<TLayer, unknown>[];
}

interface ClipboardTreeLeaf<TLeaf> {
  type: 'leaf';
  leaf: TLeaf;
}

export type ClipboardTreeItem<TLayer, TLeaf> =
  | ClipboardTreeLayer<TLayer>
  | ClipboardTreeLeaf<TLeaf>;

// ---------------------------------------------------------------------------
// Paste items into hierarchy
// ---------------------------------------------------------------------------

export function pasteClipboardItems<
  TLayer extends { id: string; name: string; parentLayerId?: string | null },
  TLeaf extends { id: string; name: string; parentLayerId?: string | null },
>(
  existingLayers: readonly TLayer[],
  existingLeaves: readonly TLeaf[],
  items: readonly ClipboardTreeItem<TLayer, TLeaf>[],
  targetParentLayerId: string | null,
  createCopiedId: (prefix: 'layer' | 'leaf') => string,
  getNextStackOrder: () => number,
): {
  layers: TLayer[];
  leaves: TLeaf[];
  selectedLayerIds: string[];
  selectedLeafIds: string[];
} {
  const nextLayers: TLayer[] = [];
  const nextLeaves: TLeaf[] = [];
  const layerById = new Map<string, TLayer>();
  const leafById = new Map<string, TLeaf>();
  const siblingGroups = new Map<string | null, { type: string; id: string }[]>();

  const assignLayerName = createUniqueItemNameAssigner(existingLayers.map((l) => l.name));
  const assignLeafName = createUniqueItemNameAssigner(existingLeaves.map((l) => l.name));

  const pushSibling = (parentLayerId: string | null, ref: { type: string; id: string }) => {
    const current = siblingGroups.get(parentLayerId) ?? [];
    current.push(ref);
    siblingGroups.set(parentLayerId, current);
  };

  const cloneLayerItem = (
    item: ClipboardTreeLayer<TLayer>,
    parentLayerId: string | null,
  ): { type: string; id: string } => {
    const clonedLayer: TLayer = {
      ...item.layer,
      id: createCopiedId('layer'),
      name: assignLayerName(item.layer.name),
      parentLayerId,
    };
    delete (clonedLayer as Record<string, unknown>).stackOrder;
    nextLayers.push(clonedLayer);
    layerById.set(clonedLayer.id, clonedLayer);
    const ref = { type: 'layer', id: clonedLayer.id };
    pushSibling(parentLayerId, ref);
    item.children.forEach((child) => {
      if (child.type === 'layer') {
        cloneLayerItem(child as ClipboardTreeLayer<TLayer>, clonedLayer.id);
      } else {
        cloneLeafItem(child as ClipboardTreeLeaf<TLeaf>, clonedLayer.id);
      }
    });
    return ref;
  };

  const cloneLeafItem = (
    item: ClipboardTreeLeaf<TLeaf>,
    parentLayerId: string | null,
  ): { type: string; id: string } => {
    const clonedLeaf: TLeaf = {
      ...item.leaf,
      id: createCopiedId('leaf'),
      name: assignLeafName(item.leaf.name),
      parentLayerId,
    };
    delete (clonedLeaf as Record<string, unknown>).stackOrder;
    nextLeaves.push(clonedLeaf);
    leafById.set(clonedLeaf.id, clonedLeaf);
    const ref = { type: 'leaf', id: clonedLeaf.id };
    pushSibling(parentLayerId, ref);
    return ref;
  };

  const topLevelRefs: { type: string; id: string }[] = [];

  items.forEach((item) => {
    if (item.type === 'layer') {
      topLevelRefs.push(cloneLayerItem(item as ClipboardTreeLayer<TLayer>, targetParentLayerId));
    } else {
      topLevelRefs.push(cloneLeafItem(item as ClipboardTreeLeaf<TLeaf>, targetParentLayerId));
    }
  });

  // Assign stack orders in reverse
  siblingGroups.forEach((refs) => {
    for (let i = refs.length - 1; i >= 0; i -= 1) {
      const ref = refs[i];
      const stackOrder = getNextStackOrder();

      if (ref.type === 'layer') {
        const layer = layerById.get(ref.id);
        if (layer) {
          (layer as Record<string, unknown>).stackOrder = stackOrder;
        }
      } else {
        const leaf = leafById.get(ref.id);
        if (leaf) {
          (leaf as Record<string, unknown>).stackOrder = stackOrder;
        }
      }
    }
  });

  return {
    layers: nextLayers,
    leaves: nextLeaves,
    selectedLayerIds: topLevelRefs
      .filter((r): r is { type: 'layer'; id: string } => r.type === 'layer')
      .map((r) => r.id),
    selectedLeafIds: topLevelRefs
      .filter((r): r is { type: string; id: string } => r.type !== 'layer')
      .map((r) => r.id),
  };
}

// ---------------------------------------------------------------------------
// Read/write clipboard helpers
// ---------------------------------------------------------------------------

export function writeClipboard<TKind extends string, TPayload>(
  kind: TKind,
  version: number,
  payload: TPayload,
): void {
  writeItemsClipboard({ kind, version: version as 1, payload });
}

export function readClipboard<TKind extends string, TPayload>(
  kind: TKind,
): { kind: TKind; version: 1; payload: TPayload } | null {
  return readItemsClipboard<TKind, TPayload>(kind);
}
