import {
  NodeType,
  AnyNode,
  Flow,
  FlowId,
  GroupNode,
  Keyframe,
  AnimatableNumber,
  type OutputTechnicalChannel,
} from '@blackboard/types';
import { nodeRegistry } from '@/nodes/registry';
import { setKeyframeValue } from '@/nodes/animation';
import { nodeFlags } from '@/nodes/helpers';
import {
  setImmutable,
  getImmutable,
  clampKeyframeTangents,
  setKeyframeOnValue,
} from '@blackboard/renderer';
import {
  buildNodeStacks,
  hasPreviousStackTarget,
  getStackedGroup,
  getStackedGroupEndIndex,
} from '@/utils/nodeStacks';
import { isNodeStacked, isStackableNode, setNodeStackedPresentation } from '@/utils/nodePredicates';
import {
  getRootFlow,
  replaceFlowNodes,
  replaceFlowStackPresentation,
  updateFlowNode,
  OUTPUT_NODE_ID,
} from '@/state/editor/flowModel';
import type { SetState, GetState, EditorState } from '@/state/editor/slices/types';
import {
  buildGraphCommandState,
  executeGraphCommand,
  createNodeCommand,
  insertNodeCommand,
  extractMergeChannelsCommand,
  connectNodeCommand,
  disconnectNodeCommand,
  disconnectNodeInputsCommand,
  deleteNodeCommand,
  deleteSelectedNodesCommand,
  groupNodesCommand,
  createNodeClipboardPayload,
  pasteNodesCommand,
  createInputNode,
  getUniqueGroupInputId,
  buildEmptyGroupFlow,
  type PasteNodesOptions,
} from '@/utils/graphCommands';
import {
  createNodeClipboardPayloadForImport,
  readNodeClipboard,
  writeNodeClipboard,
} from '@/utils/nodeClipboard';
import type { EditorMutation, CommitEditorMutation } from '@/state/editor/commitMutation';
import {
  getOutputTechnicalChannelPort,
  isOutputTechnicalChannelPort,
} from '@/color-management/outputTechnicalChannels';
import { rewirePrimaryPipeline } from '@/utils/pipelineGraph';
import { DEFAULT_COMFY_ENDPOINT } from '@/services/comfy/client';
import {
  createComfyWorkflowFromJson,
  createDefaultComfyWorkflowControls,
  getComfyWorkflowNameFromJson,
} from '@/nodes/ai/comfy/comfyWorkflowImport';
import { createComfyRootBindings } from '@/nodes/ai/comfy/comfyViewportBindings';

const rebuildActivePipelineOrder = (
  state: Readonly<EditorState>,
  orderedNodes: AnyNode[],
): Record<FlowId, Flow> | null => {
  const flowId = state.activeFlowId ?? state.rootFlowId;
  const previousFlow = flowId ? state.flows[flowId] : null;
  if (!flowId || !previousFlow) return null;

  const rebuiltFlows = replaceFlowNodes(state.flows, flowId, orderedNodes, previousFlow.name);
  return {
    ...rebuiltFlows,
    [flowId]: rewirePrimaryPipeline(previousFlow, rebuiltFlows[flowId], orderedNodes),
  };
};

const updateActiveStackPresentation = (
  state: Readonly<EditorState>,
  orderedNodes: AnyNode[],
): Record<FlowId, Flow> | null => {
  const flowId = state.activeFlowId ?? state.rootFlowId;
  return replaceFlowStackPresentation(state.flows, flowId, orderedNodes);
};

export function createNodeActions(
  set: SetState,
  get: GetState,
  deps: {
    commitMutation: CommitEditorMutation<EditorState>;
    getComfyEndpoint?: () => string;
    importComfyWorkflow?: typeof createComfyWorkflowFromJson;
    readNodeClipboard?: typeof readNodeClipboard;
  },
) {
  const copySelectedNodesToClipboard = async (): Promise<boolean> => {
    const payload = createNodeClipboardPayload(buildGraphCommandState(get()));
    if (!payload) return false;
    return writeNodeClipboard(payload);
  };

  const pasteNodesFromClipboard = async (options?: PasteNodesOptions): Promise<boolean> => {
    const clipboard = await (deps.readNodeClipboard ?? readNodeClipboard)();
    if (!clipboard) return false;

    let payload = clipboard.source === 'blackboard' ? clipboard.payload : null;
    if (clipboard.source === 'comfy') {
      try {
        const now = Date.now();
        const workflow = await (deps.importComfyWorkflow ?? createComfyWorkflowFromJson)({
          endpoint: deps.getComfyEndpoint?.() ?? DEFAULT_COMFY_ENDPOINT,
          id: `comfy_workflow_pasted_${now}_${Math.random().toString(36).slice(2, 8)}`,
          name: getComfyWorkflowNameFromJson(clipboard.workflow),
          value: clipboard.workflow,
          createdAt: now,
        });
        const createResult = createNodeCommand(
          { nodes: get().nodes, selectedNodeId: get().selectedNodeId },
          NodeType.COMFY,
          {
            workflows: [workflow],
            selectedWorkflowId: workflow.id,
            workflowControls: createDefaultComfyWorkflowControls(workflow),
            rootBindings: createComfyRootBindings(workflow),
          },
        );
        if (!createResult) return false;
        payload = createNodeClipboardPayloadForImport([createResult.finalNewNode]);
      } catch (error) {
        console.warn('Could not import nodes copied from ComfyUI.', error);
        return false;
      }
    }

    if (!payload) return false;

    const result = pasteNodesCommand(buildGraphCommandState(get()), payload, options);
    if (!result) return false;

    executeGraphCommand(deps.commitMutation, result);
    return true;
  };

  const cutSelectedNodesToClipboard = async (): Promise<boolean> => {
    const didCopy = await copySelectedNodesToClipboard();
    if (!didCopy) return false;

    const result = deleteSelectedNodesCommand(buildGraphCommandState(get()));
    if (!result) return false;

    executeGraphCommand(deps.commitMutation, {
      ...result,
      historyLabel: result.historyLabel.replace(/^Delete /, 'Cut '),
    });
    return true;
  };

  return {
    copySelectedNodesToClipboard,
    cutSelectedNodesToClipboard,
    pasteNodesFromClipboard,

    addNode: (nodeType: NodeType) => {
      if (nodeType === NodeType.EXTRACT_CHANNELS) {
        const state = buildGraphCommandState(get());
        const result = extractMergeChannelsCommand(state);
        if (result) {
          executeGraphCommand(deps.commitMutation, result);
          return;
        }
      }

      const createResult = createNodeCommand(
        { nodes: get().nodes, selectedNodeId: get().selectedNodeId },
        nodeType,
      );
      if (!createResult) return;

      const { finalNewNode, newNodes, name } = createResult;

      // Capture whether a node was selected BEFORE applying the insert,
      // because the insert always selects the new node afterwards.
      const hadSelection = !!get().selectedNodeId;

      const fullState = buildGraphCommandState(get());
      const insertResult = insertNodeCommand(fullState, finalNewNode, newNodes, name);
      executeGraphCommand(deps.commitMutation, insertResult);

      // Place the new node at the pending graph position (set by double-click
      // on the canvas) when no node was selected during creation.
      if (!hadSelection) {
        const state = get();
        const pendingPos = state.pendingNodePosition;
        if (pendingPos) {
          const positionFlowId = state.activeFlowId ?? state.rootFlowId;
          if (positionFlowId) {
            const prevPositions = state.nodePositionsByFlow[positionFlowId] ?? {};
            set(() => ({
              nodePositionsByFlow: {
                ...state.nodePositionsByFlow,
                [positionFlowId]: {
                  ...prevPositions,
                  [finalNewNode.id]: { x: pendingPos.x, y: pendingPos.y },
                },
              },
              pendingNodePosition: null,
            }));
          }
        }
      }
    },

    addNodeWithProps: (
      nodeType: NodeType,
      props: Record<string, unknown>,
      options?: { name?: string; graphPosition?: { x: number; y: number } },
    ) => {
      const createResult = createNodeCommand(
        { nodes: get().nodes, selectedNodeId: get().selectedNodeId },
        nodeType,
        props,
        options?.name ? { name: options.name } : undefined,
      );
      if (!createResult) return;

      const { finalNewNode, newNodes, name } = createResult;

      const fullState = buildGraphCommandState(get());
      const insertResult = insertNodeCommand(fullState, finalNewNode, newNodes, name);
      const positionFlowId = fullState.activeFlowId ?? fullState.rootFlowId;
      if (options?.graphPosition && positionFlowId) {
        const nextPositionsByFlow =
          insertResult.layoutPatch.nodePositionsByFlow ?? fullState.nodePositionsByFlow;
        insertResult.layoutPatch.nodePositionsByFlow = {
          ...nextPositionsByFlow,
          [positionFlowId]: {
            ...(nextPositionsByFlow[positionFlowId] ?? {}),
            [finalNewNode.id]: options.graphPosition,
          },
        };
      }
      executeGraphCommand(deps.commitMutation, insertResult);
      return finalNewNode.id;
    },

    groupSelectedNodes: () => {
      const state = buildGraphCommandState(get());
      const result = groupNodesCommand(state);
      if (!result) return;
      executeGraphCommand(deps.commitMutation, result);
    },

    openGroupNode: (nodeId: string) => {
      const { flows, activeFlowId, nodePositionsByFlow = {} } = get();
      const activeFlow = getRootFlow(flows, activeFlowId);
      const groupNode = activeFlow?.nodes.find(
        (node): node is GroupNode => node.id === nodeId && node.type === NodeType.GROUP,
      );
      if (!groupNode || !activeFlowId) return;

      const childFlowId = groupNode.childFlowId ?? `flow_group_${groupNode.id}`;
      const childFlow = flows[childFlowId] ?? buildEmptyGroupFlow(childFlowId, groupNode.name);
      const parentFlow: Flow =
        groupNode.childFlowId === childFlowId
          ? activeFlow
          : {
              ...activeFlow,
              nodes: activeFlow.nodes.map((node) =>
                node.id === groupNode.id ? ({ ...groupNode, childFlowId } as GroupNode) : node,
              ),
            };
      const nextFlows = {
        ...flows,
        [activeFlowId]: parentFlow,
        [childFlowId]: childFlow,
      };

      set(() => ({
        flows: nextFlows,
        activeFlowId: childFlowId,
        selectedNodeId: null,
        selectedNodeIds: [],
        nodePositionsByFlow: {
          ...nodePositionsByFlow,
          [childFlowId]: nodePositionsByFlow[childFlowId] ?? {},
        },
      }));
    },

    openFlow: (flowId: string) => {
      const { flows } = get();
      const flow = getRootFlow(flows, flowId);
      if (!flow) return;
      set(() => ({
        activeFlowId: flow.id,
        selectedNodeId: null,
        selectedNodeIds: [],
      }));
    },

    exposeGroupInput: (
      groupNodeId: string,
      targetNodeId: string,
      targetPort: string,
      label?: string,
    ) => {
      deps.commitMutation((state) => {
        const activeFlow = getRootFlow(state.flows, state.activeFlowId);
        const groupNode = activeFlow?.nodes.find(
          (node): node is GroupNode => node.id === groupNodeId && node.type === NodeType.GROUP,
        );
        if (!activeFlow || !state.activeFlowId || !groupNode?.childFlowId) return { patch: {} };
        const childFlow = state.flows[groupNode.childFlowId];
        if (!childFlow?.nodes.some((node) => node.id === targetNodeId)) return { patch: {} };

        const externalInputs = groupNode.externalInputs ?? [];
        if (
          externalInputs.some(
            (input) => input.targetNodeId === targetNodeId && input.targetPort === targetPort,
          )
        ) {
          return { patch: {} };
        }

        const inputId = getUniqueGroupInputId(
          targetNodeId,
          targetPort,
          new Set(externalInputs.map((input) => input.id)),
        );
        const reusableEntryNode =
          targetPort === 'pipe' && groupNode.inputNodeId
            ? childFlow.nodes.find((node) => node.id === groupNode.inputNodeId)
            : null;
        const entryNode =
          reusableEntryNode ??
          createInputNode(groupNode.id, inputId, label || `${targetNodeId} ${targetPort}`);
        const nextExternalInputs = [
          ...externalInputs,
          {
            id: inputId,
            label: label || `${targetNodeId} ${targetPort}`,
            entryNodeId: entryNode.id,
            targetNodeId,
            targetPort,
          },
        ];
        const nextGroupNode: GroupNode = { ...groupNode, externalInputs: nextExternalInputs };
        const targetIndex = childFlow.nodes.findIndex((node) => node.id === targetNodeId);
        const childNodes = [...childFlow.nodes];
        if (reusableEntryNode) {
          childNodes.forEach((node, index) => {
            if (node.id === reusableEntryNode.id) {
              childNodes[index] = {
                ...node,
                name: label || `${targetNodeId} ${targetPort}`,
                externalInputId: inputId,
              } as AnyNode;
            }
          });
        } else {
          childNodes.splice(Math.max(0, targetIndex), 0, entryNode as AnyNode);
        }
        const nextChildFlow: Flow = {
          ...childFlow,
          nodes: childNodes,
          edges: [
            ...childFlow.edges.filter(
              (edge) =>
                !(
                  edge.sourceNodeId === entryNode.id &&
                  edge.targetNodeId === targetNodeId &&
                  edge.targetPort === targetPort
                ),
            ),
            {
              id: `edge_${entryNode.id}_${targetNodeId}_${targetPort}`,
              sourceNodeId: entryNode.id,
              sourcePort: 'output',
              targetNodeId,
              targetPort,
            },
          ],
        };
        const nextParentFlow: Flow = {
          ...activeFlow,
          nodes: activeFlow.nodes.map((node) => (node.id === groupNode.id ? nextGroupNode : node)),
        };
        const nextFlows = {
          ...state.flows,
          [state.activeFlowId]: nextParentFlow,
          [childFlow.id]: nextChildFlow,
        };

        return {
          patch: { flows: nextFlows },
          history: {
            label: 'Expose Group Input',
            state: { flows: nextFlows, selectedNodeId: groupNode.id },
          },
        };
      });
    },

    updateGroupChildField: (
      groupNodeId: string,
      targetNodeId: string,
      propertyPath: string,
      value: unknown,
      preserveAnimation = false,
      withHistory = true,
    ) => {
      deps.commitMutation((state) => {
        const activeFlow = getRootFlow(state.flows, state.activeFlowId);
        const groupNode = activeFlow?.nodes.find(
          (node): node is GroupNode => node.id === groupNodeId && node.type === NodeType.GROUP,
        );
        if (!activeFlow || !groupNode?.childFlowId) return { patch: {} };

        const childFlow = state.flows[groupNode.childFlowId];
        const targetIndex = childFlow?.nodes.findIndex((node) => node.id === targetNodeId) ?? -1;
        if (!childFlow || targetIndex < 0) return { patch: {} };

        const targetNode = childFlow.nodes[targetIndex];
        const currentValue = getImmutable(targetNode, propertyPath);
        if (currentValue === undefined) return { patch: {} };

        const nextValue =
          preserveAnimation && typeof value === 'number' && Array.isArray(currentValue)
            ? setKeyframeOnValue(currentValue as AnimatableNumber, state.currentFrame, value)
            : value;
        const pathRoot = propertyPath.match(/^[^.[\]]+/)?.[0];
        const updatedTargetNode = setImmutable(targetNode, propertyPath, nextValue) as AnyNode;
        let nextTargetNode = updatedTargetNode;
        let historyLabel = 'Update Group Prop';
        const hook = nodeRegistry.get(targetNode.type)?.onNodeUpdate;
        if (hook && pathRoot) {
          const sceneNode = state.nodes.find((candidate) => nodeFlags(candidate.type).isSceneLike);
          const hookResult = hook(
            targetNode,
            { [pathRoot]: (updatedTargetNode as unknown as Record<string, unknown>)[pathRoot] },
            { sceneNode },
          );
          nextTargetNode = { ...updatedTargetNode, ...hookResult.changes } as AnyNode;
          historyLabel = hookResult.label ?? historyLabel;
        }
        const nextChildNodes = [...childFlow.nodes];
        nextChildNodes[targetIndex] = nextTargetNode;
        const nextFlows = {
          ...state.flows,
          [childFlow.id]: { ...childFlow, nodes: nextChildNodes },
        };

        return withHistory
          ? {
              patch: { flows: nextFlows },
              history: {
                label: historyLabel,
                state: { flows: nextFlows, selectedNodeId: groupNode.id },
              },
            }
          : {
              patch: { flows: nextFlows },
              persist: 'debounced' as const,
            };
      });
    },

    removeGroupInput: (groupNodeId: string, inputId: string) => {
      deps.commitMutation((state) => {
        const activeFlow = getRootFlow(state.flows, state.activeFlowId);
        const groupNode = activeFlow?.nodes.find(
          (node): node is GroupNode => node.id === groupNodeId && node.type === NodeType.GROUP,
        );
        if (!activeFlow || !state.activeFlowId || !groupNode?.childFlowId) return { patch: {} };
        const targetInput = groupNode.externalInputs?.find((input) => input.id === inputId);
        const childFlow = state.flows[groupNode.childFlowId];
        if (!targetInput || !childFlow) return { patch: {} };

        const nextGroupInputs = { ...(groupNode.inputs ?? {}) };
        delete nextGroupInputs[inputId];
        const nextExternalInputs = groupNode.externalInputs?.filter(
          (input) => input.id !== inputId,
        );
        const shouldRemoveEntryNode =
          targetInput.entryNodeId !== groupNode.inputNodeId &&
          !(nextExternalInputs ?? []).some(
            (input) => input.entryNodeId === targetInput.entryNodeId,
          );
        const nextGroupNode: GroupNode = {
          ...groupNode,
          externalInputs: nextExternalInputs,
          inputs: Object.keys(nextGroupInputs).length > 0 ? nextGroupInputs : undefined,
        };
        const nextParentFlow: Flow = {
          ...activeFlow,
          nodes: activeFlow.nodes.map((node) => (node.id === groupNode.id ? nextGroupNode : node)),
          edges: activeFlow.edges.filter(
            (edge) => !(edge.targetNodeId === groupNode.id && edge.targetPort === inputId),
          ),
        };
        const nextChildFlow: Flow = {
          ...childFlow,
          nodes: shouldRemoveEntryNode
            ? childFlow.nodes.filter((node) => node.id !== targetInput.entryNodeId)
            : childFlow.nodes,
          edges: childFlow.edges.filter(
            (edge) =>
              !(
                edge.sourceNodeId === targetInput.entryNodeId &&
                edge.targetNodeId === targetInput.targetNodeId &&
                edge.targetPort === targetInput.targetPort
              ) &&
              !(
                shouldRemoveEntryNode &&
                (edge.sourceNodeId === targetInput.entryNodeId ||
                  edge.targetNodeId === targetInput.entryNodeId)
              ),
          ),
        };
        const nextFlows = {
          ...state.flows,
          [state.activeFlowId]: nextParentFlow,
          [childFlow.id]: nextChildFlow,
        };

        return {
          patch: { flows: nextFlows },
          history: {
            label: 'Remove Group Input',
            state: { flows: nextFlows, selectedNodeId: groupNode.id },
          },
        };
      });
    },

    updateNode: (nodeId: string, updates: Partial<AnyNode>, withHistory = false) => {
      deps.commitMutation((state) => {
        const targetNode = state.nodes.find((l) => l.id === nodeId);
        if (!targetNode) return { patch: {} };

        const sceneNode = state.nodes.find((l) => nodeFlags(l.type).isSceneLike);

        // Delegate to node's onNodeUpdate hook if available
        let label = 'Update Node';
        let finalChanges: Record<string, unknown> = updates as Record<string, unknown>;
        const hook = nodeRegistry.get(targetNode.type)?.onNodeUpdate;
        if (hook) {
          const result = hook(targetNode, updates as Record<string, unknown>, { sceneNode });
          finalChanges = result.changes;
          if (result.label) label = result.label;
        }

        const newNodes = state.nodes.map((l) =>
          l.id === nodeId ? ({ ...l, ...finalChanges } as AnyNode) : l,
        );

        const patch: Record<string, unknown> = { nodes: newNodes };

        // Scene fps sync side effect
        if ('fps' in finalChanges && nodeFlags(targetNode.type).isSceneLike) {
          patch.fps = finalChanges.fps as number;
        }

        const result: EditorMutation<EditorState> = { patch };

        if (withHistory) {
          result.history = {
            label,
            state: { nodes: newNodes, selectedNodeId: state.selectedNodeId },
          };
        } else {
          result.persist = 'debounced';
        }

        return result;
      });
    },

    batchUpdateNodes: (
      nodeIds: string[],
      updates: Partial<AnyNode> | ((node: AnyNode) => Partial<AnyNode>),
      withHistory = false,
    ) => {
      deps.commitMutation((state) => {
        const idSet = new Set(nodeIds);
        const newNodes = state.nodes.map((l) =>
          idSet.has(l.id)
            ? ({ ...l, ...(typeof updates === 'function' ? updates(l) : updates) } as AnyNode)
            : l,
        );

        const result: EditorMutation<EditorState> = { patch: { nodes: newNodes } };

        if (withHistory) {
          result.history = {
            label: `Batch Update ${nodeIds.length} Nodes`,
            state: { nodes: newNodes, selectedNodeId: state.selectedNodeId },
          };
        } else {
          result.persist = 'debounced';
        }

        return result;
      });
    },

    toggleNodeEnabled: (nodeId: string) => {
      deps.commitMutation((state) => {
        const newNodes = state.nodes.map((l) =>
          l.id === nodeId ? { ...l, enabled: !l.enabled } : l,
        );
        return {
          patch: { nodes: newNodes },
          history: {
            label: `Toggle ${newNodes.find((l) => l.id === nodeId)?.name} enabled`,
            state: { nodes: newNodes },
          },
        };
      });
    },

    setNodeEnabled: (nodeId: string, enabled: boolean) => {
      deps.commitMutation((state) => {
        const newNodes = state.nodes.map((l) => (l.id === nodeId ? { ...l, enabled } : l));
        return {
          patch: { nodes: newNodes },
          history: {
            label: `${enabled ? 'Enable' : 'Disable'} ${newNodes.find((l) => l.id === nodeId)?.name}`,
            state: { nodes: newNodes },
          },
        };
      });
    },

    toggleNodeStacking: (nodeId: string) => {
      deps.commitMutation((state) => {
        const layerIndex = state.nodes.findIndex((l) => l.id === nodeId);
        if (layerIndex === -1) return { patch: {} };
        const node = state.nodes[layerIndex];
        const currentlyStacked = isNodeStacked(node);
        if (!currentlyStacked && !isStackableNode(node)) return { patch: {} };
        const nextStacked = !currentlyStacked;
        if (nextStacked && !hasPreviousStackTarget(state.nodes, nodeId)) return { patch: {} };
        const newNodes = state.nodes.map((candidate) =>
          candidate.id === nodeId ? setNodeStackedPresentation(candidate, nextStacked) : candidate,
        );
        const newNode = newNodes.find((candidate) => candidate.id === nodeId);
        const flows = updateActiveStackPresentation(state, newNodes);
        if (!flows) return { patch: {} };
        return {
          patch: { flows },
          history: {
            label: `${nextStacked ? 'Stack' : 'Unstack'} ${newNode?.name}`,
            state: { flows },
          },
        };
      });
    },

    stackNodeOntoStack: (nodeId: string, targetStackId: string): boolean => {
      const state = get();
      const sourceIndex = state.nodes.findIndex((node) => node.id === nodeId);
      if (sourceIndex === -1 || nodeId === targetStackId) return false;

      const sourceNode = state.nodes[sourceIndex];
      if (!isStackableNode(sourceNode)) {
        return false;
      }

      const currentStacks = buildNodeStacks(state.nodes);
      const sourceStack = currentStacks.find((stack) => stack[0].id === nodeId);
      const targetStack = currentStacks.find((stack) => stack[0].id === targetStackId);
      if (!sourceStack || !targetStack || targetStack.some((node) => node.id === nodeId)) {
        return false;
      }

      let result = false;
      deps.commitMutation((currentState) => {
        const nodes = [...currentState.nodes];
        const groupToMove = nodes.slice(sourceIndex, sourceIndex + sourceStack.length);
        nodes.splice(sourceIndex, groupToMove.length);

        const targetIndex = nodes.findIndex((node) => node.id === targetStackId);
        if (targetIndex === -1) return { patch: {} };

        const insertionIndex = getStackedGroupEndIndex(nodes, targetIndex);

        const stackedGroup = groupToMove.map((node, index) =>
          index === 0 ? setNodeStackedPresentation(node, true) : node,
        );
        nodes.splice(insertionIndex + 1, 0, ...stackedGroup);

        const flows = updateActiveStackPresentation(currentState, nodes);
        if (!flows) return { patch: {} };
        result = true;
        return {
          patch: { flows, selectedNodeId: currentState.selectedNodeId },
          history: {
            label: `Stack ${sourceNode.name}`,
            state: {
              flows,
              selectedNodeId: currentState.selectedNodeId,
              nodePositionsByFlow: currentState.nodePositionsByFlow,
            },
          },
        };
      });

      return result;
    },

    reorderNodes: (dragIndices: number[], dropIndex: number) => {
      deps.commitMutation((state) => {
        const nodes = [...state.nodes];
        if (dragIndices.length === 0) return { patch: {} };

        const sortedAsc = [...dragIndices].sort((a, b) => a - b);

        // Collect all items to move (each drag index + its stacked adjustments)
        const allItemsToMove: AnyNode[] = [];
        const allRemoveIndices: number[] = [];

        for (const idx of sortedAsc) {
          const item = nodes[idx];
          if (!item) continue;
          const group = getStackedGroup(nodes, idx);
          allItemsToMove.push(...group);
          for (let j = idx; j < idx + group.length; j++) {
            allRemoveIndices.push(j);
          }
        }

        // Remove items from highest index to lowest to preserve indices
        const newNodes = [...nodes];
        const sortedDescIndices = [...allRemoveIndices].sort((a, b) => b - a);
        for (const idx of sortedDescIndices) {
          newNodes.splice(idx, 1);
        }

        // Find drop position
        const dropNodeId = nodes[dropIndex].id;
        let insertionIndex = newNodes.findIndex((l) => l.id === dropNodeId);
        if (insertionIndex === -1) {
          return { patch: {} };
        }

        // If dragging downward, insert after the full drop target stack
        if (sortedAsc[0] < dropIndex) {
          insertionIndex = getStackedGroupEndIndex(newNodes, insertionIndex) + 1;
        }

        newNodes.splice(insertionIndex, 0, ...allItemsToMove);

        const flows = rebuildActivePipelineOrder(state, newNodes);
        if (!flows) return { patch: {} };

        return {
          patch: { flows },
          history: {
            label: 'Reorder Nodes',
            state: { flows },
          },
        };
      });
    },

    deleteNode: (nodeId: string) => {
      const state = buildGraphCommandState(get());
      const result = deleteNodeCommand(state, nodeId);
      executeGraphCommand(deps.commitMutation, result);
    },

    deleteSelectedNodes: () => {
      const state = buildGraphCommandState(get());
      const result = deleteSelectedNodesCommand(state);
      if (!result) return;
      executeGraphCommand(deps.commitMutation, result);
    },

    connectNodeInput: (
      nodeId: string,
      portName: string,
      sourceNodeId: string,
      sourcePortName = 'output',
    ) => {
      const state = buildGraphCommandState(get());
      const result = connectNodeCommand(state, nodeId, portName, sourceNodeId, sourcePortName);
      if (!result) return;
      executeGraphCommand(deps.commitMutation, result);
    },

    disconnectNodeInput: (nodeId: string, portName: string) => {
      const state = buildGraphCommandState(get());
      const result = disconnectNodeCommand(state, nodeId, portName);
      if (!result) return;
      executeGraphCommand(deps.commitMutation, result);
    },

    disconnectNodeInputs: (targets: readonly { nodeId: string; portName: string }[]) => {
      const state = buildGraphCommandState(get());
      const result = disconnectNodeInputsCommand(state, targets);
      if (!result) return;
      executeGraphCommand(deps.commitMutation, result);
    },

    setOutputTechnicalChannels: (channels: OutputTechnicalChannel[], withHistory = true) => {
      deps.commitMutation((state) => {
        const flowId = state.activeFlowId ?? state.rootFlowId;
        const flow = flowId ? state.flows[flowId] : null;
        if (!flowId || !flow) return { patch: {} };

        const retainedPorts = new Set(
          channels.map((channel) => getOutputTechnicalChannelPort(channel.id)),
        );
        const updatedFlows = updateFlowNode(state.flows, flowId, OUTPUT_NODE_ID, {
          technicalChannels: channels,
        } as Partial<AnyNode>);
        if (!updatedFlows) return { patch: {} };

        const updatedFlow = updatedFlows[flowId];
        const nextFlows = {
          ...updatedFlows,
          [flowId]: {
            ...updatedFlow,
            edges: updatedFlow.edges.filter(
              (edge) =>
                edge.targetNodeId !== OUTPUT_NODE_ID ||
                !isOutputTechnicalChannelPort(edge.targetPort) ||
                retainedPorts.has(edge.targetPort),
            ),
          },
        };

        return withHistory
          ? {
              patch: { flows: nextFlows },
              history: {
                label: 'Update output channels',
                state: { flows: nextFlows, selectedNodeId: state.selectedNodeId },
              },
            }
          : {
              patch: { flows: nextFlows },
              persist: 'debounced',
            };
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
      deps.commitMutation((state) => {
        const targetFrame = frame !== undefined ? frame : state.currentFrame;
        const layerIndex = state.nodes.findIndex((l) => l.id === nodeId);
        if (layerIndex === -1) return { patch: {} };

        let newNodes = state.nodes as AnyNode[];
        const node = state.nodes[layerIndex];
        const existingProp = getImmutable(node, propertyPath);

        if (value !== undefined && !forceKeyframe && !Array.isArray(existingProp)) {
          if (existingProp === undefined) return { patch: {} };
          const updatedNode = setImmutable(node, propertyPath, value) as AnyNode;
          newNodes = [...state.nodes];
          newNodes[layerIndex] = updatedNode;
        } else {
          newNodes = setKeyframeValue(state.nodes, nodeId, propertyPath, targetFrame, value);
        }

        const result: EditorMutation<EditorState> = { patch: { nodes: newNodes } };

        if (withHistory) {
          result.history = {
            label: 'Set Keyframe',
            state: {
              nodes: newNodes,
              selectedNodeId: state.selectedNodeId,
              currentFrame: targetFrame,
            },
          };
        }

        return result;
      });
    },

    updateKeyframe: (
      nodeId: string,
      propertyPath: string,
      frame: number,
      updates: Partial<Keyframe>,
      withHistory = true,
    ) => {
      deps.commitMutation((state) => {
        const layerIndex = state.nodes.findIndex((l) => l.id === nodeId);
        if (layerIndex === -1) return { patch: {} };

        const node = state.nodes[layerIndex];
        const prop = getImmutable(node, propertyPath) as AnimatableNumber;
        if (!Array.isArray(prop)) return { patch: {} };

        const keyframes = [...prop];
        const kfIndex = keyframes.findIndex((k) => k.frame === frame);
        if (kfIndex === -1) return { patch: {} };

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
          const nextObject = obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : {};
          const child = nextObject[head] ?? {};
          return {
            ...nextObject,
            [head]: setDeep(child, tail, val),
          };
        };

        const pathParts = propertyPath.replace(/\[(\d+)\]/g, '.$1').split('.');
        const newNode = setDeep(node, pathParts, keyframes) as AnyNode;

        const newNodes = [...state.nodes];
        newNodes[layerIndex] = newNode;

        const result: EditorMutation<EditorState> = { patch: { nodes: newNodes } };

        if (withHistory) {
          const targetFrame = updates.frame ?? frame;
          result.history = {
            label: 'Update Keyframe',
            state: {
              nodes: newNodes,
              selectedNodeId: state.selectedNodeId,
              currentFrame: targetFrame,
            },
          };
        }

        return result;
      });
    },
  };
}
