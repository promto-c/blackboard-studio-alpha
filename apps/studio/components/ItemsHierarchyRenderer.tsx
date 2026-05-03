import React from 'react';

interface ItemsHierarchyRendererProps<TItem> {
  items: readonly TItem[];
  getKey: (item: TItem) => React.Key;
  getChildren: (item: TItem) => readonly TItem[];
  isExpanded?: (item: TItem) => boolean;
  renderItem: (item: TItem, children: React.ReactNode | null) => React.ReactNode;
}

function ItemsHierarchyRendererInner<TItem>({
  items,
  getKey,
  getChildren,
  isExpanded,
  renderItem,
}: ItemsHierarchyRendererProps<TItem>) {
  return (
    <>
      {items.map((item) => {
        const childItems = getChildren(item);
        const children =
          childItems.length > 0 && (isExpanded?.(item) ?? true) ? (
            <ItemsHierarchyRenderer
              items={childItems}
              getKey={getKey}
              getChildren={getChildren}
              isExpanded={isExpanded}
              renderItem={renderItem}
            />
          ) : null;

        return <React.Fragment key={getKey(item)}>{renderItem(item, children)}</React.Fragment>;
      })}
    </>
  );
}

const ItemsHierarchyRenderer = React.memo(
  ItemsHierarchyRendererInner,
) as typeof ItemsHierarchyRendererInner;

export default ItemsHierarchyRenderer;
