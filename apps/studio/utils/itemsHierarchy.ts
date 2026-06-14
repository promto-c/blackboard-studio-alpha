import type { LayerOption } from '@/components';

interface HierarchyItemWithLayer {
  type: string;
  depth: number;
  children?: readonly HierarchyItemWithLayer[];
  layer?: { id: string; name: string };
}

export interface HierarchyItemNode {
  type: string;
  depth: number;
  visible: boolean;
  activeAtFrame?: boolean;
  layer?: { id: string; name: string; expanded?: boolean };
  children?: readonly HierarchyItemNode[];
  stroke?: { id: string; name: string };
  path?: { id: string; name: string };
}

export const getLayerOptions = <T extends HierarchyItemWithLayer>(
  items: readonly T[],
  options: LayerOption[] = [],
): LayerOption[] => {
  items.forEach((item) => {
    if (item.type !== 'layer' || !item.layer) return;
    options.push({
      id: item.layer.id,
      label: `${item.depth > 0 ? `${'-- '.repeat(item.depth)}` : ''}${item.layer.name}`,
    });
    if (item.children) {
      getLayerOptions(item.children as T[], options);
    }
  });
  return options;
};
