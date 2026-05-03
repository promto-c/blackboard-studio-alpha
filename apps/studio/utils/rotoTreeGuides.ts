import type { RotoHierarchyItem } from '@/utils/rotoHierarchy';
import {
  TREE_GUIDE_START,
  TREE_GUIDE_STEP,
  collectTreeGuideSegments as collectGenericTreeGuideSegments,
  type TreeGuideAdapter,
  type TreeGuideRowMetric,
  type TreeGuideSegment,
} from '@/utils/treeGuides';

export { TREE_GUIDE_START, TREE_GUIDE_STEP, type TreeGuideRowMetric, type TreeGuideSegment };

const rotoTreeGuideAdapter: TreeGuideAdapter<RotoHierarchyItem> = {
  getKey: (item) => (item.type === 'layer' ? `layer:${item.layer.id}` : `path:${item.path.id}`),
  getDepth: (item) => item.depth,
  getChildren: (item) => (item.type === 'layer' ? item.children : []),
  isExpanded: (item) => item.type !== 'layer' || item.layer.expanded !== false,
};

export const collectTreeGuideSegments = (
  items: readonly RotoHierarchyItem[],
  rowMetrics: ReadonlyMap<string, TreeGuideRowMetric>,
  segments: TreeGuideSegment[] = [],
): TreeGuideSegment[] =>
  collectGenericTreeGuideSegments(items, rowMetrics, rotoTreeGuideAdapter, segments);
