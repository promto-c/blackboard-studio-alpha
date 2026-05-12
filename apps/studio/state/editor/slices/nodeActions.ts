import {
  HistoryEntry,
  NodeType,
  AnyNode,
  EditorTab,
  Keyframe,
  AnimatableNumber,
  NodePositions,
} from '@blackboard/types';
import { effectRegistry } from '@/effects/effectRegistry';
import { setKeyframeValue } from '@/effects/effectAnimation';
import { getDefaultViewportTool, nodeFlags } from '@/effects/effectHelpers';
import { getNodeCount } from '@/state/editor/selectors';
import { setImmutable, getImmutable, clampKeyframeTangents } from '@blackboard/renderer';
import { NODE_WIDTH, HORIZONTAL_GAP, VERTICAL_GAP } from '@/utils/autoLayoutGraph';
import { buildMergeModel, isMergeNodeId, type MergeModel } from '@/utils/mergeNodes';
import { buildNodeStacks, hasPreviousStackTarget } from '@/utils/nodeStacks';
import {
  isNodeStacked,
  isStackedAdjustmentNode,
  isStackAdjustmentType,
} from '@/utils/nodePredicates';
import { wouldCreateCycle, cleanDanglingNodeInputs } from '@/utils/connectionGraph';
import {
  sanitizeActiveViewerSlot,
  sanitizeViewerNodeId,
  sanitizeViewerSlots,
} from '@/utils/viewerSlots';
import type { SetState, GetState } from '@/state/editor/slices/types';

type GraphPoint = { x: number; y: number };

type StackPositionTemplate = {
  anchor: GraphPoint;
  sourceOffset: GraphPoint;
};

const DEFAULT_MERGE_SOURCE_OFFSET: GraphPoint = {
  x: -(NODE_WIDTH + HORIZONTAL_GAP),
  y: -VERTICAL_GAP,
};

function getStackPositionTemplate(
  stackId: string,
  mergeModel: MergeModel,
  nodePositions: NodePositions,
): StackPositionTemplate | null {
  const mergeInfo = mergeModel.info.get(stackId);
  if (!mergeInfo) {
    return null;
  }

  const basePos = nodePositions[stackId];

  if (mergeInfo.isMergeSource && mergeInfo.mergeId) {
    const mergePos = nodePositions[mergeInfo.mergeId];

    if (mergePos && basePos) {
      return {
        anchor: mergePos,
        sourceOffset: {
          x: basePos.x - mergePos.x,
          y: basePos.y - mergePos.y,
        },
      };
    }

    if (mergePos) {
      return {
        anchor: mergePos,
        sourceOffset: DEFAULT_MERGE_SOURCE_OFFSET,
      };
    }

    if (basePos) {
      return {
        anchor: {
          x: basePos.x - DEFAULT_MERGE_SOURCE_OFFSET.x,
          y: basePos.y - DEFAULT_MERGE_SOURCE_OFFSET.y,
        },
        sourceOffset: DEFAULT_MERGE_SOURCE_OFFSET,
      };
    }

    return null;
  }

  if (!basePos) {
    return null;
  }

  return {
    anchor: basePos,
    sourceOffset: DEFAULT_MERGE_SOURCE_OFFSET,
  };
}

function applyStackPositionTemplate(
  targetStackId: string,
  mergeModel: MergeModel,
  template: StackPositionTemplate,
  nodePositions: NodePositions,
) {
  const mergeInfo = mergeModel.info.get(targetStackId);
  if (!mergeInfo) {
    return;
  }

  if (mergeInfo.isMergeSource && mergeInfo.mergeId) {
    nodePositions[targetStackId] = {
      x: template.anchor.x + template.sourceOffset.x,
      y: template.anchor.y + template.sourceOffset.y,
    };
    nodePositions[mergeInfo.mergeId] = template.anchor;
    return;
  }

  nodePositions[targetStackId] = template.anchor;
}

export function createNodeActions(
  set: SetState,
  get: GetState,
  deps: {
    pushHistory: (entry: Omit<HistoryEntry, 'id'>) => void;
    debouncedSave: () => void;
  },
) {
  function createNode(
    nodeType: NodeType,
    props: Record<string, unknown> = {},
    options?: { name?: string },
  ): { finalNewNode: AnyNode; newNodes: AnyNode[]; name: string } | null {
    const definition = effectRegistry.get(nodeType);
    if (!definition) return null;
    const { nodes: currentNodes, selectedNodeId } = get();
    let name = options?.name ?? definition.name;
    const existingCount = getNodeCount(currentNodes, nodeType);
    if (!options?.name && existingCount > 0) name = `${definition.name} ${existingCount + 1}`;
    const nodeData = definition.getInitialNodeProps?.() ?? definition.getInitialNodeProps();
    const newNodeBase = {
      ...nodeData,
      ...props,
      id: `${nodeType}_${Date.now()}`,
      type: nodeType,
      name,
      visible: true,
    };
    const selectedIndex = selectedNodeId
      ? currentNodes.findIndex((node) => node.id === selectedNodeId)
      : -1;
    const selectedNode = selectedIndex !== -1 ? currentNodes[selectedIndex] : null;
    const finalNewNode = newNodeBase as AnyNode;
    const newNodes = [...currentNodes];
    if (!selectedNode || nodeFlags(selectedNode.type).isSceneLike) {
      newNodes.push(finalNewNode);
    } else {
      let insertIndex = selectedIndex;
      for (let i = selectedIndex + 1; i < currentNodes.length; i++) {
        const nextNode = currentNodes[i];
        if (isStackedAdjustmentNode(nextNode)) {
          insertIndex = i;
        } else {
          break;
        }
      }
      newNodes.splice(insertIndex + 1, 0, finalNewNode);
    }
    return { finalNewNode, newNodes, name };
  }

  function commitNewNode(finalNewNode: AnyNode, newNodes: AnyNode[], name: string) {
    set(() => ({
      nodes: newNodes,
      selectedNodeId: finalNewNode.id,
      activeTab: EditorTab.Flow,
      activeViewportTool: getDefaultViewportTool(finalNewNode.type),
    }));
    deps.pushHistory({
      label: `Add ${name} Node`,
      state: { nodes: newNodes, selectedNodeId: finalNewNode.id },
    });
  }

  return {
    addNode: (nodeType: NodeType) => {
      const result = createNode(nodeType);
      if (!result) return;
      commitNewNode(result.finalNewNode, result.newNodes, result.name);
    },

    addNodeWithProps: (
      nodeType: NodeType,
      props: Record<string, unknown>,
      options?: { name?: string },
    ) => {
      const result = createNode(nodeType, props, options);
      if (!result) return;
      commitNewNode(result.finalNewNode, result.newNodes, result.name);
    },

    updateNode: (nodeId: string, updates: Partial<AnyNode>, withHistory = false) => {
      let label = 'Update Node';
      const { nodes } = get();
      const targetNode = nodes.find((l) => l.id === nodeId);
      if (!targetNode) return;

      const sceneNode = nodes.find((l) => nodeFlags(l.type).isSceneLike);

      // Delegate to effect's onNodeUpdate hook if available
      let finalChanges: Record<string, unknown> = updates as Record<string, unknown>;
      const hook = effectRegistry.get(targetNode.type)?.onNodeUpdate;
      if (hook) {
        const result = hook(targetNode, updates as Record<string, unknown>, { sceneNode });
        finalChanges = result.changes;
        if (result.label) label = result.label;
      }

      const newNodes = nodes.map((l) =>
        l.id === nodeId ? ({ ...l, ...finalChanges } as AnyNode) : l,
      );

      // Scene fps sync side effect
      if ('fps' in finalChanges && nodeFlags(targetNode.type).isSceneLike) {
        set(() => ({ fps: finalChanges.fps as number }));
      }

      set(() => ({ nodes: newNodes }));
      if (withHistory) {
        deps.pushHistory({
          label,
          state: { nodes: newNodes, selectedNodeId: get().selectedNodeId },
        });
      } else {
        deps.debouncedSave();
      }
    },

    toggleNodeVisibility: (nodeId: string) => {
      const newNodes = get().nodes.map((l) =>
        l.id === nodeId ? { ...l, visible: !l.visible } : l,
      );
      set(() => ({ nodes: newNodes }));
      deps.pushHistory({
        label: `Toggle ${newNodes.find((l) => l.id === nodeId)?.name} visibility`,
        state: { nodes: newNodes },
      });
    },

    toggleNodeStacking: (nodeId: string) => {
      const { nodes } = get();
      const layerIndex = nodes.findIndex((l) => l.id === nodeId);
      if (layerIndex === -1) return;
      const node = nodes[layerIndex];
      const isAdjustment = isStackAdjustmentType(node.type);
      if (!isAdjustment) return;
      const nextStacked = !isNodeStacked(node);
      if (nextStacked && !hasPreviousStackTarget(nodes, nodeId)) return;
      const newNodes = nodes.map((l) =>
        l.id === nodeId ? ({ ...l, stacked: nextStacked } as AnyNode) : l,
      );
      set(() => ({ nodes: newNodes }));
      const newNode = newNodes.find((l) => l.id === nodeId) as
        | (AnyNode & { stacked?: boolean })
        | undefined;
      deps.pushHistory({
        label: `${newNode?.stacked ? 'Stack' : 'Unstack'} ${newNode?.name}`,
        state: { nodes: newNodes },
      });
    },

    stackNodeOntoStack: (nodeId: string, targetStackId: string): boolean => {
      const { nodes, selectedNodeId, nodePositions = {} } = get();
      const sourceIndex = nodes.findIndex((node) => node.id === nodeId);
      if (sourceIndex === -1 || nodeId === targetStackId) return false;

      const sourceNode = nodes[sourceIndex];
      if (!isStackAdjustmentType(sourceNode.type)) {
        return false;
      }

      const currentStacks = buildNodeStacks(nodes);
      const sourceStack = currentStacks.find((stack) => stack[0].id === nodeId);
      const targetStack = currentStacks.find((stack) => stack[0].id === targetStackId);
      if (!sourceStack || !targetStack || targetStack.some((node) => node.id === nodeId)) {
        return false;
      }

      const newNodes = [...nodes];
      const groupToMove = newNodes.slice(sourceIndex, sourceIndex + sourceStack.length);
      newNodes.splice(sourceIndex, groupToMove.length);

      const targetIndex = newNodes.findIndex((node) => node.id === targetStackId);
      if (targetIndex === -1) return false;

      let insertionIndex = targetIndex;
      for (let i = targetIndex + 1; i < newNodes.length; i++) {
        if (!isStackedAdjustmentNode(newNodes[i])) {
          break;
        }
        insertionIndex = i;
      }

      const stackedGroup = groupToMove.map((node, index) =>
        index === 0 ? ({ ...node, stacked: true } as AnyNode) : node,
      );
      newNodes.splice(insertionIndex + 1, 0, ...stackedGroup);

      const newStacks = buildNodeStacks(newNodes);
      const newMergeModel = buildMergeModel(newStacks);
      const expectedMergeIds = new Set(
        newMergeModel.mergeNodes.map((mergeNode) => mergeNode.mergeId),
      );
      const updatedNodePositions = { ...nodePositions };

      delete updatedNodePositions[nodeId];
      for (const positionId of Object.keys(updatedNodePositions)) {
        if (isMergeNodeId(positionId) && !expectedMergeIds.has(positionId)) {
          delete updatedNodePositions[positionId];
        }
      }

      set(() => ({
        nodes: newNodes,
        selectedNodeId,
        nodePositions: updatedNodePositions,
      }));
      deps.pushHistory({
        label: `Stack ${sourceNode.name}`,
        state: {
          nodes: newNodes,
          selectedNodeId,
          nodePositionsByFlow: get().nodePositionsByFlow,
        },
      });

      return true;
    },

    reorderNodes: (dragIndex: number, dropIndex: number) => {
      const { nodes } = get();
      const newNodes = [...nodes];
      const draggedItem = newNodes[dragIndex];
      if (!draggedItem) return;
      const groupToMove: AnyNode[] = [draggedItem];
      for (let i = dragIndex + 1; i < nodes.length; i++) {
        const node = nodes[i];
        if (isStackedAdjustmentNode(node)) {
          groupToMove.push(node);
        } else {
          break;
        }
      }
      newNodes.splice(dragIndex, groupToMove.length);
      const dropNodeId = nodes[dropIndex].id;
      let insertionIndex = newNodes.findIndex((l) => l.id === dropNodeId);
      if (insertionIndex === -1) {
        set(() => ({ nodes }));
        return;
      }
      if (dragIndex < dropIndex) {
        let dropStackEndIndex = insertionIndex;
        for (let i = insertionIndex + 1; i < newNodes.length; i++) {
          const node = newNodes[i];
          if (isStackedAdjustmentNode(node)) {
            dropStackEndIndex = i;
          } else {
            break;
          }
        }
        insertionIndex = dropStackEndIndex + 1;
      }
      newNodes.splice(insertionIndex, 0, ...groupToMove);

      const { nodePositions } = get();
      const dragId = draggedItem.id;
      const oldStacks = buildNodeStacks(nodes);
      const newStacks = buildNodeStacks(newNodes);
      const oldMergeModel = buildMergeModel(oldStacks);
      const newMergeModel = buildMergeModel(newStacks);

      const oldStackIds = oldStacks.map((stack) => stack[0].id);
      const oldIdx = oldStackIds.indexOf(dragId);
      const newStackIds = newStacks.map((stack) => stack[0].id);
      const newIdx = newStackIds.indexOf(dragId);

      let updatedNodePositions = nodePositions;
      if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
        const lo = Math.min(oldIdx, newIdx);
        const hi = Math.max(oldIdx, newIdx);
        const affectedOldIds = oldStackIds.slice(lo, hi + 1);
        const affectedNewIds = newStackIds.slice(lo, hi + 1);
        const mergeIdsToClear = new Set<string>();

        updatedNodePositions = { ...nodePositions };
        for (const stackId of affectedOldIds) {
          const mergeId = oldMergeModel.info.get(stackId)?.mergeId;
          if (mergeId) {
            mergeIdsToClear.add(mergeId);
          }
        }
        for (const stackId of affectedNewIds) {
          const mergeId = newMergeModel.info.get(stackId)?.mergeId;
          if (mergeId) {
            mergeIdsToClear.add(mergeId);
          }
        }

        for (const mergeId of mergeIdsToClear) {
          delete updatedNodePositions[mergeId];
        }

        for (let i = 0; i < affectedNewIds.length; i++) {
          const targetStackId = affectedNewIds[i];
          const sourceStackId = affectedOldIds[i];
          const template = getStackPositionTemplate(sourceStackId, oldMergeModel, nodePositions);

          if (!template) {
            continue;
          }

          applyStackPositionTemplate(targetStackId, newMergeModel, template, updatedNodePositions);
        }
      }

      const expectedMergeIds = new Set(
        newMergeModel.mergeNodes.map((mergeNode) => mergeNode.mergeId),
      );
      for (const nodeId of Object.keys(updatedNodePositions)) {
        if (isMergeNodeId(nodeId) && !expectedMergeIds.has(nodeId)) {
          delete updatedNodePositions[nodeId];
        }
      }

      set(() => ({ nodes: newNodes, nodePositions: updatedNodePositions }));
      deps.pushHistory({
        label: 'Reorder Nodes',
        state: { nodes: newNodes, nodePositions: updatedNodePositions },
      });
    },

    deleteNode: (nodeId: string) => {
      const { nodes, selectedNodeId, viewerSlots, viewerNodeId, activeViewerSlot } = get();
      const layerToDeleteIndex = nodes.findIndex((l) => l.id === nodeId);
      if (layerToDeleteIndex === -1 || nodeFlags(nodes[layerToDeleteIndex].type).isProtected)
        return;

      let deleteCount = 1;
      for (let i = layerToDeleteIndex + 1; i < nodes.length; i++) {
        const nextNode = nodes[i];
        if (isStackedAdjustmentNode(nextNode)) {
          deleteCount++;
        } else {
          break;
        }
      }

      const deletedIds = new Set(
        nodes.slice(layerToDeleteIndex, layerToDeleteIndex + deleteCount).map((l) => l.id),
      );

      const newNodes = [...nodes];
      newNodes.splice(layerToDeleteIndex, deleteCount);

      // Clean up dangling input references to deleted nodes
      const cleanedNodes = cleanDanglingNodeInputs(newNodes, deletedIds);

      // Clean up node positions for deleted nodes
      const { nodePositions } = get();
      const cleanedPositions = { ...nodePositions };
      let positionsChanged = false;
      for (const id of deletedIds) {
        if (id in cleanedPositions) {
          delete cleanedPositions[id];
          positionsChanged = true;
        }
      }

      let newSelectedNodeId = selectedNodeId;
      if (
        selectedNodeId === nodeId ||
        (nodes.findIndex((l) => l.id === selectedNodeId) > layerToDeleteIndex &&
          nodes.findIndex((l) => l.id === selectedNodeId) < layerToDeleteIndex + deleteCount)
      ) {
        const newIndex = Math.max(0, layerToDeleteIndex - 1);
        newSelectedNodeId = cleanedNodes[newIndex]?.id || null;
      }

      const cleanedViewerSlots = sanitizeViewerSlots(viewerSlots, cleanedNodes);
      const cleanedViewerNodeId = sanitizeViewerNodeId(viewerNodeId, cleanedNodes);
      const cleanedActiveViewerSlot = sanitizeActiveViewerSlot(
        activeViewerSlot,
        cleanedViewerSlots,
        cleanedViewerNodeId,
      );

      set(() => ({
        nodes: cleanedNodes,
        selectedNodeId: newSelectedNodeId,
        viewerSlots: cleanedViewerSlots,
        viewerNodeId: cleanedViewerNodeId,
        activeViewerSlot: cleanedActiveViewerSlot,
        ...(positionsChanged ? { nodePositions: cleanedPositions } : {}),
      }));
      deps.pushHistory({
        label: 'Delete Node',
        state: { nodes: cleanedNodes, selectedNodeId: newSelectedNodeId },
      });
    },

    connectNodeInput: (nodeId: string, portName: string, sourceNodeId: string) => {
      const { nodes } = get();

      // Validation
      if (nodeId === sourceNodeId) return;
      if (!nodes.find((l) => l.id === sourceNodeId)) return;
      if (wouldCreateCycle(nodes, nodeId, sourceNodeId, portName)) return;

      const node = nodes.find((l) => l.id === nodeId);
      if (!node) return;

      const newInputs = { ...(node.inputs || {}), [portName]: sourceNodeId };
      const newNodes = nodes.map((l) => (l.id === nodeId ? { ...l, inputs: newInputs } : l));

      set(() => ({ nodes: newNodes }));
      deps.pushHistory({
        label: `Connect ${portName} input`,
        state: { nodes: newNodes, selectedNodeId: get().selectedNodeId },
      });
    },

    disconnectNodeInput: (nodeId: string, portName: string) => {
      const { nodes } = get();
      const node = nodes.find((l) => l.id === nodeId);
      if (!node?.inputs?.[portName]) return;

      const newInputs = { ...node.inputs };
      delete newInputs[portName];
      const newNodes = nodes.map((l) =>
        l.id === nodeId
          ? { ...l, inputs: Object.keys(newInputs).length > 0 ? newInputs : undefined }
          : l,
      );

      set(() => ({ nodes: newNodes }));
      deps.pushHistory({
        label: `Disconnect ${portName} input`,
        state: { nodes: newNodes, selectedNodeId: get().selectedNodeId },
      });
    },

    setKeyframe: (
      nodeId: string,
      propertyPath: string,
      value?: number,
      withHistory = true,
      frame?: number,
      forceKeyframe = false,
    ) => {
      const { nodes, currentFrame } = get();
      const targetFrame = frame !== undefined ? frame : currentFrame;
      const layerIndex = nodes.findIndex((l) => l.id === nodeId);
      if (layerIndex === -1) return;

      let newNodes = nodes;
      const node = nodes[layerIndex];
      const existingProp = getImmutable(node, propertyPath);

      if (value !== undefined && !forceKeyframe && !Array.isArray(existingProp)) {
        if (existingProp === undefined) return;
        const updatedNode = setImmutable(node, propertyPath, value) as AnyNode;
        newNodes = [...nodes];
        newNodes[layerIndex] = updatedNode;
      } else {
        newNodes = setKeyframeValue(nodes, nodeId, propertyPath, targetFrame, value);
      }

      set(() => ({ nodes: newNodes }));
      if (withHistory) {
        deps.pushHistory({
          label: `Set Keyframe`,
          state: {
            nodes: newNodes,
            selectedNodeId: get().selectedNodeId,
            currentFrame: targetFrame,
          },
        });
      }
    },

    updateKeyframe: (
      nodeId: string,
      propertyPath: string,
      frame: number,
      updates: Partial<Keyframe>,
      withHistory = true,
    ) => {
      const { nodes } = get();
      const layerIndex = nodes.findIndex((l) => l.id === nodeId);
      if (layerIndex === -1) return;

      const node = nodes[layerIndex];
      const prop = getImmutable(node, propertyPath) as AnimatableNumber;
      if (Array.isArray(prop)) {
        const keyframes = [...prop];
        const kfIndex = keyframes.findIndex((k) => k.frame === frame);
        if (kfIndex !== -1) {
          const updatedKeyframe = { ...keyframes[kfIndex], ...updates };
          keyframes[kfIndex] = updatedKeyframe;
          if (updates.frame !== undefined) {
            keyframes.sort((a, b) => a.frame - b.frame);
          }

          if (
            updates.frame !== undefined ||
            updates.inTangent !== undefined ||
            updates.outTangent !== undefined
          ) {
            const updatedIndex = keyframes.indexOf(updatedKeyframe);
            if (updatedIndex !== -1) {
              keyframes[updatedIndex] = clampKeyframeTangents(keyframes, updatedIndex);
            }
          }

          const setDeep = (obj: unknown, path: string[], val: unknown): unknown => {
            if (path.length === 0) return val;

            const [head, ...tail] = path;
            if (Array.isArray(obj)) {
              const nextArray = [...obj];
              const index = Number.parseInt(head, 10);
              nextArray[index] = setDeep(obj[index], tail, val);
              return nextArray;
            }

            const nextObject =
              obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : {};
            const child = nextObject[head] ?? {};
            return {
              ...nextObject,
              [head]: setDeep(child, tail, val),
            };
          };

          const pathParts = propertyPath.replace(/\[(\d+)\]/g, '.$1').split('.');
          const newNode = setDeep(node, pathParts, keyframes) as AnyNode;

          const newNodes = [...nodes];
          newNodes[layerIndex] = newNode;
          set(() => ({ nodes: newNodes }));

          if (withHistory) {
            const targetFrame = updates.frame ?? frame;
            deps.pushHistory({
              label: `Update Keyframe`,
              state: {
                nodes: newNodes,
                selectedNodeId: get().selectedNodeId,
                currentFrame: targetFrame,
              },
            });
          }
        }
      }
    },
  };
}
