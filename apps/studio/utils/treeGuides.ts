export type TreeGuideSegment =
  | {
      key: string;
      orientation: 'horizontal';
      left: number;
      top: number;
      width: number;
    }
  | {
      key: string;
      orientation: 'vertical';
      left: number;
      top: number;
      height: number;
    };

export type TreeGuideRowMetric = {
  height: number;
  top: number;
};

export interface TreeGuideAdapter<TItem> {
  getKey: (item: TItem) => string;
  getDepth: (item: TItem) => number;
  getChildren: (item: TItem) => readonly TItem[];
  isExpanded?: (item: TItem) => boolean;
}

export const TREE_GUIDE_STEP = 18;
export const TREE_GUIDE_START = 12;

export const collectTreeGuideSegments = <TItem>(
  items: readonly TItem[],
  rowMetrics: ReadonlyMap<string, TreeGuideRowMetric>,
  adapter: TreeGuideAdapter<TItem>,
  segments: TreeGuideSegment[] = [],
): TreeGuideSegment[] => {
  items.forEach((item) => {
    const rowKey = adapter.getKey(item);
    const metric = rowMetrics.get(rowKey);
    const depth = adapter.getDepth(item);

    if (metric && depth > 0) {
      segments.push({
        key: `horizontal:${rowKey}`,
        orientation: 'horizontal',
        left: TREE_GUIDE_START + (depth - 1) * TREE_GUIDE_STEP,
        top: metric.top + metric.height / 2,
        width: TREE_GUIDE_STEP - 8,
      });
    }

    const allChildren = adapter.getChildren(item);
    if (allChildren.length === 0) {
      return;
    }

    const visibleChildren = adapter.isExpanded?.(item) === false ? [] : allChildren;
    if (metric && visibleChildren.length > 0) {
      const lastChildMetric = rowMetrics.get(
        adapter.getKey(visibleChildren[visibleChildren.length - 1]),
      );

      if (lastChildMetric) {
        const top = metric.top + metric.height / 2;
        const height = lastChildMetric.top + lastChildMetric.height / 2 - top;

        if (height > 0) {
          segments.push({
            key: `vertical:${rowKey}`,
            orientation: 'vertical',
            left: TREE_GUIDE_START + depth * TREE_GUIDE_STEP,
            top,
            height,
          });
        }
      }
    }

    if (visibleChildren.length > 0) {
      collectTreeGuideSegments(visibleChildren, rowMetrics, adapter, segments);
    }
  });

  return segments;
};
