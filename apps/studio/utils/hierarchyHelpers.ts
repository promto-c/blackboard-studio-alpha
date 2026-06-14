export const normalizeParentId = <T extends { parentLayerId?: string | null }>(
  item: T,
  validLayerIds: Set<string>,
  selfId?: string,
): string | null => {
  const parentId = item.parentLayerId ?? null;
  if (!parentId || (selfId !== undefined && parentId === selfId) || !validLayerIds.has(parentId)) {
    return null;
  }
  return parentId;
};

export const getHierarchyItemKey = (item: { type: string; id: string }): string =>
  `${item.type}:${item.id}`;

export const isSameHierarchyItem = (
  a: { type: string; id: string },
  b: { type: string; id: string },
): boolean => a.type === b.type && a.id === b.id;
