import { useCallback, useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  NodeType,
  type ComfyNode,
  type SceneNode,
  type ViewportPromptRegion,
} from '@blackboard/types';
import {
  COMFY_CROP_VIEWPORT_TOOL,
  createComfyViewportPromptRegionDeleteUpdate,
  createComfyViewportPromptRegion,
  getExplicitSelectedComfyViewportPromptRegion,
  mergeComfyViewportBindings,
} from './comfyViewportBindings';

type DragHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | 'draw';

interface DragState {
  regionId: string;
  handle: DragHandle;
  startPoint: { x: number; y: number };
  startRect: ViewportPromptRegion['rect'];
}

const MIN_SIZE = 8;

const normalizeRect = (
  rect: ViewportPromptRegion['rect'],
  _sceneNode: SceneNode,
): ViewportPromptRegion['rect'] => {
  // Allow coordinates to extend beyond the scene bounds so that
  // regions can be used for outpainting.
  const x1 = Math.min(rect.x, rect.x + rect.width);
  const y1 = Math.min(rect.y, rect.y + rect.height);
  const x2 = Math.max(rect.x, rect.x + rect.width);
  const y2 = Math.max(rect.y, rect.y + rect.height);

  return {
    x: x1,
    y: y1,
    width: Math.max(MIN_SIZE, x2 - x1),
    height: Math.max(MIN_SIZE, y2 - y1),
  };
};

const toScenePixel = (sceneNode: SceneNode, scenePos: { x: number; y: number }) => ({
  x: scenePos.x + sceneNode.width / 2,
  y: scenePos.y + sceneNode.height / 2,
});

const hitHandle = (
  rect: ViewportPromptRegion['rect'],
  point: { x: number; y: number },
  tolerance: number,
): DragHandle | null => {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const nearX = (x: number) => Math.abs(point.x - x) <= tolerance;
  const nearY = (y: number) => Math.abs(point.y - y) <= tolerance;

  if (nearX(left) && nearY(top)) return 'nw';
  if (nearX(right) && nearY(top)) return 'ne';
  if (nearX(left) && nearY(bottom)) return 'sw';
  if (nearX(right) && nearY(bottom)) return 'se';
  if (nearY(top) && point.x >= left && point.x <= right) return 'n';
  if (nearY(bottom) && point.x >= left && point.x <= right) return 's';
  if (nearX(left) && point.y >= top && point.y <= bottom) return 'w';
  if (nearX(right) && point.y >= top && point.y <= bottom) return 'e';

  if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) return 'move';
  return null;
};

const resizeRect = (
  startRect: ViewportPromptRegion['rect'],
  handle: DragHandle,
  delta: { x: number; y: number },
  sceneNode: SceneNode,
): ViewportPromptRegion['rect'] => {
  if (handle === 'move') {
    // Allow moving regions outside scene bounds for outpainting
    return {
      ...startRect,
      x: startRect.x + delta.x,
      y: startRect.y + delta.y,
    };
  }

  if (handle === 'draw') {
    return normalizeRect(
      {
        x: startRect.x,
        y: startRect.y,
        width: delta.x,
        height: delta.y,
      },
      sceneNode,
    );
  }

  const next = { ...startRect };
  if (handle.includes('w')) {
    next.x = startRect.x + delta.x;
    next.width = startRect.width - delta.x;
  }
  if (handle.includes('e')) {
    next.width = startRect.width + delta.x;
  }
  if (handle.includes('n')) {
    next.y = startRect.y + delta.y;
    next.height = startRect.height - delta.y;
  }
  if (handle.includes('s')) {
    next.height = startRect.height + delta.y;
  }

  return normalizeRect(next, sceneNode);
};

export interface UseComfyCropInteractionParams {
  selectedNode: ComfyNode | undefined;
  sceneNode: SceneNode | undefined;
  activeViewportTool: string | null;
  zoom: number;
  updateNode: (nodeId: string, updates: Partial<ComfyNode>, withHistory?: boolean) => void;
  setHierarchySelection?: (nodeId: string, layerIds: string[], itemIds: string[]) => void;
}

export const useComfyCropInteraction = ({
  selectedNode,
  sceneNode,
  activeViewportTool,
  zoom,
  updateNode,
  setHierarchySelection,
}: UseComfyCropInteractionParams) => {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [justCreatedRegionId, setJustCreatedRegionId] = useState<string | null>(null);
  const workflow = useMemo(() => {
    if (!selectedNode) return null;
    return (
      selectedNode.workflows.find(
        (candidate) => candidate.id === selectedNode.selectedWorkflowId,
      ) ??
      selectedNode.workflows[0] ??
      null
    );
  }, [selectedNode]);

  const isCropToolActive =
    selectedNode?.type === NodeType.COMFY && activeViewportTool === COMFY_CROP_VIEWPORT_TOOL;
  const isSelectToolActive =
    selectedNode?.type === NodeType.COMFY && activeViewportTool === 'select';

  const updateRegions = useCallback(
    (
      node: ComfyNode,
      regions: ViewportPromptRegion[],
      selectedRegionId: string | undefined,
      withHistory: boolean,
    ) => {
      updateNode(
        node.id,
        {
          viewportPromptRegions: regions,
          selectedViewportPromptRegionId: selectedRegionId,
        },
        withHistory,
      );
      setHierarchySelection?.(node.id, selectedRegionId ? [selectedRegionId] : [], []);
    },
    [setHierarchySelection, updateNode],
  );

  const handleMouseDown = useCallback(
    (
      event: ReactMouseEvent,
      _mousePos: { x: number; y: number },
      scenePos: { x: number; y: number },
    ): boolean => {
      if (
        !selectedNode ||
        !sceneNode ||
        (!isCropToolActive && !isSelectToolActive) ||
        event.button !== 0
      ) {
        return false;
      }

      const point = toScenePixel(sceneNode, scenePos);
      const regions = selectedNode.viewportPromptRegions ?? [];
      const visibleRegions = regions.filter((region) => region.visible !== false);
      const tolerance = 10 / Math.max(zoom, 0.1);

      const findHitRegion = () =>
        event.shiftKey
          ? undefined
          : [...visibleRegions]
              .reverse()
              .map((region) => ({ region, handle: hitHandle(region.rect, point, tolerance) }))
              .find((candidate) => candidate.handle);

      if (isSelectToolActive) {
        event.preventDefault();
        event.stopPropagation();
        const hit = findHitRegion();
        updateRegions(selectedNode, regions, hit?.region.id, false);
        if (hit?.region.id !== justCreatedRegionId) {
          setJustCreatedRegionId(null);
        }
        return true;
      }

      event.preventDefault();
      event.stopPropagation();

      const hitRegion = findHitRegion();

      if (hitRegion?.handle) {
        updateRegions(selectedNode, regions, hitRegion.region.id, false);
        if (hitRegion.region.id !== justCreatedRegionId) {
          setJustCreatedRegionId(null);
        }
        setDragState({
          regionId: hitRegion.region.id,
          handle: hitRegion.handle,
          startPoint: point,
          startRect: hitRegion.region.rect,
        });
        return true;
      }

      // Always append the new region here. The stale-region replacement
      // happens in handleMouseUp after confirming the drag was successful.
      const region = createComfyViewportPromptRegion(
        workflow,
        {
          x: point.x,
          y: point.y,
          width: MIN_SIZE,
          height: MIN_SIZE,
        },
        selectedNode.viewportPromptRegionDefaults,
      );
      const nextRegions = [...regions, region];
      updateRegions(selectedNode, nextRegions, region.id, false);
      setDragState({
        regionId: region.id,
        handle: 'draw',
        startPoint: point,
        startRect: region.rect,
      });
      return true;
    },
    [
      isCropToolActive,
      isSelectToolActive,
      justCreatedRegionId,
      sceneNode,
      selectedNode,
      updateRegions,
      workflow,
      zoom,
    ],
  );

  const handleMouseMove = useCallback(
    (
      event: MouseEvent | ReactMouseEvent,
      _mousePos: { x: number; y: number },
      scenePos: { x: number; y: number },
    ): boolean => {
      if (!selectedNode || !sceneNode || !dragState) return false;
      event.preventDefault();

      const point = toScenePixel(sceneNode, scenePos);
      const delta = { x: point.x - dragState.startPoint.x, y: point.y - dragState.startPoint.y };
      const regions = (selectedNode.viewportPromptRegions ?? []).map((region) => {
        if (region.id !== dragState.regionId) return region;
        return {
          ...region,
          rect: resizeRect(dragState.startRect, dragState.handle, delta, sceneNode),
          bindings: mergeComfyViewportBindings(workflow, region.bindings),
        };
      });
      updateRegions(selectedNode, regions, dragState.regionId, false);
      return true;
    },
    [dragState, sceneNode, selectedNode, updateRegions, workflow],
  );

  const handleMouseUp = useCallback(() => {
    if (!selectedNode || !dragState) return;

    const allRegions = selectedNode.viewportPromptRegions ?? [];

    // If the user just clicked or dragged a negligible amount (draw handle,
    // final rect still at MIN_SIZE), discard the region entirely instead of
    // committing it to history.
    if (dragState.handle === 'draw') {
      const region = allRegions.find((r) => r.id === dragState.regionId);
      if (region && region.rect.width === MIN_SIZE && region.rect.height === MIN_SIZE) {
        const nextRegions = allRegions.filter((r) => r.id !== dragState.regionId);
        updateRegions(selectedNode, nextRegions, undefined, false);
        setDragState(null);
        // Don't clear justCreatedRegionId — the stale candidate remains for
        // the next successful draw.
        return;
      }
    }

    // On a successful draw, check whether the most recently created region
    // (tracked by justCreatedRegionId) is stale (empty prompt) and should be
    // replaced by the new region.
    if (dragState.handle === 'draw' && justCreatedRegionId) {
      const staleRegion = allRegions.find((r) => r.id === justCreatedRegionId);
      if (staleRegion && staleRegion.prompt === '' && staleRegion.id !== dragState.regionId) {
        // Remove the stale region (its replacement is the newly drawn one
        // already in the array). Also clean up any orphaned outputs.
        const nextRegions = allRegions.filter((r) => r.id !== staleRegion.id);
        const nextOutputs = (selectedNode.generatedOutputs ?? []).filter(
          (output) => output.regionId !== staleRegion.id,
        );
        updateNode(
          selectedNode.id,
          {
            viewportPromptRegions: nextRegions,
            selectedViewportPromptRegionId: dragState.regionId,
            generatedOutputs: nextOutputs,
          },
          true,
        );
        setHierarchySelection?.(selectedNode.id, [dragState.regionId], []);
        setJustCreatedRegionId(dragState.regionId);
        setDragState(null);
        return;
      }
    }

    updateRegions(selectedNode, allRegions, dragState.regionId, true);
    if (dragState.handle === 'draw') {
      setJustCreatedRegionId(dragState.regionId);
    }
    setDragState(null);
  }, [
    dragState,
    justCreatedRegionId,
    selectedNode,
    updateRegions,
    updateNode,
    setHierarchySelection,
  ]);

  const deleteSelectedRegion = useCallback((): boolean => {
    if (!selectedNode) return false;

    const region = getExplicitSelectedComfyViewportPromptRegion(selectedNode);
    if (!region) return false;

    const update = createComfyViewportPromptRegionDeleteUpdate(selectedNode, [region.id]);
    if (!update) return false;

    updateNode(selectedNode.id, update, true);
    setHierarchySelection?.(
      selectedNode.id,
      update.selectedViewportPromptRegionId ? [update.selectedViewportPromptRegionId] : [],
      [],
    );
    setDragState(null);
    return true;
  }, [selectedNode, setHierarchySelection, updateNode]);

  const cleanupOnToolChange = useCallback(() => {
    setDragState(null);
    setJustCreatedRegionId(null);
  }, []);

  return {
    dragState,
    justCreatedRegionId,
    isCropToolActive,
    shouldForceOverlays: isSelectToolActive || isCropToolActive || Boolean(dragState),
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    deleteSelectedRegion,
    cleanupOnToolChange,
  };
};
