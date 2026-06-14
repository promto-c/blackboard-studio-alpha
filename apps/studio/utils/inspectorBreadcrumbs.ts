import type { ComfyNode, RotoNode, RotoPath, Scene3DNode } from '@blackboard/types';
import { getRotoLayerMap, getRotoPathParentLayerId } from '@/utils/rotoHierarchy';

type InspectorBreadcrumbTarget = 'layer' | 'shape' | 'region' | 'output' | 'scene3d_item';

interface InspectorBreadcrumbItemModel {
  id: string;
  label: string;
  target: InspectorBreadcrumbTarget;
}

export const getRotoInspectorBreadcrumbItems = ({
  node,
  selectedLayerId,
  selectedPath,
}: {
  node: RotoNode;
  selectedLayerId: string | null;
  selectedPath: RotoPath | null;
}): InspectorBreadcrumbItemModel[] => {
  const layerMap = getRotoLayerMap(node);
  const items: InspectorBreadcrumbItemModel[] = [];
  const seen = new Set<string>();

  const pushLayerChain = (layerId: string | null) => {
    if (!layerId) return;
    const chain: InspectorBreadcrumbItemModel[] = [];
    let currentLayer = layerMap.get(layerId);
    while (currentLayer) {
      chain.unshift({
        id: currentLayer.id,
        label: currentLayer.name,
        target: 'layer',
      });
      if (!currentLayer.parentLayerId) break;
      currentLayer = layerMap.get(currentLayer.parentLayerId);
    }
    chain.forEach((item) => {
      const key = `${item.target}:${item.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push(item);
    });
  };

  pushLayerChain(selectedLayerId);

  if (selectedPath) {
    pushLayerChain(getRotoPathParentLayerId(node, selectedPath));
    const key = `shape:${selectedPath.id}`;
    if (!seen.has(key)) {
      items.push({
        id: selectedPath.id,
        label: selectedPath.name,
        target: 'shape',
      });
    }
  }

  return items;
};

export const getComfyInspectorBreadcrumbItems = ({
  node,
  selectedRegionId,
  selectedOutputId,
}: {
  node: ComfyNode;
  selectedRegionId: string | null;
  selectedOutputId?: string | null;
}): InspectorBreadcrumbItemModel[] => {
  const items: InspectorBreadcrumbItemModel[] = [];

  if (selectedRegionId) {
    const regions = node.viewportPromptRegions ?? [];
    const regionIndex = regions.findIndex((region) => region.id === selectedRegionId);
    if (regionIndex >= 0) {
      items.push({
        id: selectedRegionId,
        label: `Region ${regionIndex + 1}`,
        target: 'region',
      });
    }
  }

  if (selectedOutputId) {
    const outputs = node.generatedOutputs ?? [];
    const output = outputs.find((candidate) => candidate.id === selectedOutputId);
    if (output) {
      // If the output belongs to a region and no region is in the breadcrumb yet, add it as parent
      if (output.regionId && !items.some((i) => i.id === output.regionId)) {
        const regions = node.viewportPromptRegions ?? [];
        const regionIndex = regions.findIndex((r) => r.id === output.regionId);
        if (regionIndex >= 0) {
          items.push({
            id: output.regionId,
            label: `Region ${regionIndex + 1}`,
            target: 'region',
          });
        }
      }

      const outputIndex = outputs.findIndex((candidate) => candidate.id === selectedOutputId);
      items.push({
        id: selectedOutputId,
        label: output.label ?? `Output ${outputIndex + 1}`,
        target: 'output',
      });
    }
  }

  return items;
};

export const getScene3DInspectorBreadcrumbItems = ({
  node,
  selectedItemId,
}: {
  node: Scene3DNode;
  selectedItemId: string | null;
}): InspectorBreadcrumbItemModel[] => {
  if (!selectedItemId) return [];
  const item = node.scene3d?.items?.find((candidate) => candidate.id === selectedItemId);
  if (!item) return [];
  return [
    {
      id: item.id,
      label: item.name,
      target: 'scene3d_item',
    },
  ];
};
