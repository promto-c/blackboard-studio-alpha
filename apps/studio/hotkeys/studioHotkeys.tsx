import React, { useCallback, useMemo } from 'react';
import { getAnimatableProperties } from '@/effects/effectAnimation';
import { effectRegistry } from '@/effects/effectRegistry';
import { nodeFlags } from '@/effects/effectHelpers';
import { OUTPUT_NODE_ID } from '@/state/editor/flowModel';
import { isMergeNodeId } from '@/utils/mergeNodes';
import isTextEntryTarget from '@/utils/isTextEntryTarget';
import {
  clampSelectionToScope,
  getTextSelectionScope,
  isSelectableTextTarget,
  selectTextSelectionScope,
} from '@/utils/textSelectionScope';
import { useEditorActions, useEditorSelector } from '@/state/editorContext';
import { useSelectedEditorNode } from '@/hooks/useEditorNodes';
import { usePreferences } from '@/state/preferencesContext';
import {
  EditorTab,
  NodeType,
  type AnyNode,
  type PaintNode,
  type RotoPointRef,
  type RotoNode,
  type ViewerSettings,
} from '@blackboard/types';
import { HotkeyProvider } from './provider';
import type {
  HotkeyBinding,
  HotkeyCommand,
  HotkeyExecutionContext,
  HotkeyScopeId,
  HotkeyView,
  KeyboardSnapshot,
} from './types';

const isWithinRoot = (target: EventTarget | null, root: HTMLElement | null): target is Node => {
  return !!root && target instanceof Node && root.contains(target);
};

export const shouldPreventBrowserZoomGesture = (
  event: Pick<WheelEvent, 'ctrlKey' | 'metaKey' | 'target'>,
  root: HTMLElement | null,
): boolean => {
  if (!event.ctrlKey && !event.metaKey) {
    return false;
  }

  return isWithinRoot(event.target, root) && !isTextEntryTarget(event.target);
};

export const shouldPreventNativeDragOrSelection = (
  target: EventTarget | null,
  root: HTMLElement | null,
): boolean => {
  return (
    isWithinRoot(target, root) && !isTextEntryTarget(target) && !isSelectableTextTarget(target)
  );
};

interface StudioHotkeyActionSet {
  activateViewerSlot: (slot: number) => void;
  assignViewerSlot: (slot: number, nodeId: string) => void;
  cancelDrawingShape: () => void;
  deleteSelectedRotoPoints: () => void;
  deleteSelectedRotoShapes: () => void;
  setSelectedPaintLayerIds: (layerIds: string[]) => void;
  setSelectedPaintStrokeIds: (strokeIds: string[]) => void;
  setSelectedRotoSelection: (selection: {
    layerIds: string[];
    pathIds: string[];
    pointRefs?: RotoPointRef[];
  }) => void;
  playPause: () => void;
  redo: () => void;
  redoDrawingPoint: () => void;
  seekFrame: (frame: number) => void;
  setActiveTab: (tab: EditorTab) => void;
  setActiveViewportTool: (tool: string | null) => void;
  setSubPanelVisible: (visible: boolean) => void;
  setViewerSettings: (updates: Partial<ViewerSettings>) => void;
  toggleStabilize: () => void;
  undo: () => void;
  undoDrawingPoint: () => void;
  deleteNode: (nodeId: string) => void;
}

const getStudioActions = (context: HotkeyExecutionContext): StudioHotkeyActionSet =>
  context.actions as unknown as StudioHotkeyActionSet;

const getVisibleKeyframeFrames = (
  selectedNode: AnyNode | null,
  selectedRotoPathIds: string[],
): number[] => {
  if (!selectedNode) return [];

  const frames = new Set<number>();
  const props = getAnimatableProperties(selectedNode, { selectedRotoPathIds });
  props.forEach((prop) => {
    if (Array.isArray(prop.prop)) {
      prop.prop.forEach((keyframe) => frames.add(keyframe.frame));
    }
  });
  return Array.from(frames).sort((left, right) => left - right);
};

const getValidRotoPointRefs = (
  selectedNode: AnyNode | null,
  selectedRotoPathIds: string[],
  pointRefs: RotoPointRef[],
): RotoPointRef[] => {
  // Q restores only a previously-used point subset for the current shape selection.
  // If the shape set changed or points no longer exist, we intentionally stay in shape mode.
  if (!selectedNode || selectedNode.type !== NodeType.ROTO || selectedRotoPathIds.length === 0) {
    return [];
  }

  const selectedPathIdSet = new Set(selectedRotoPathIds);
  const rotoNode = selectedNode as RotoNode;
  const pathPointCountById = new Map(
    rotoNode.paths.map((path) => [path.id, path.points.length] as const),
  );
  return pointRefs.filter((pointRef) => {
    if (!selectedPathIdSet.has(pointRef.pathId)) return false;
    const pointCount = pathPointCountById.get(pointRef.pathId);
    return pointCount !== undefined && pointRef.pointIndex >= 0 && pointRef.pointIndex < pointCount;
  });
};

const getSelectedViewerTargetId = (selectedNode: AnyNode | null, selectedNodeId: string | null) => {
  if (selectedNode && !nodeFlags(selectedNode.type).isSceneLike) {
    return selectedNode.id;
  }

  if (!selectedNodeId) {
    return null;
  }

  if (selectedNodeId === OUTPUT_NODE_ID || isMergeNodeId(selectedNodeId)) {
    return selectedNodeId;
  }

  return null;
};

const getActiveView = (scopeId: HotkeyScopeId): HotkeyView => {
  if (scopeId.startsWith('flow')) return 'flow';
  if (scopeId.startsWith('timeline')) return 'timeline';
  if (scopeId === 'viewport') return 'viewport';
  return 'global';
};

const getFlowMode = (
  scopeId: HotkeyScopeId,
  fallback: 'list' | 'graph',
): 'list' | 'graph' | null => {
  if (scopeId === 'flow.list') return 'list';
  if (scopeId === 'flow.graph') return 'graph';
  return scopeId.startsWith('flow') ? fallback : null;
};

const getTimelineMode = (scopeId: HotkeyScopeId): 'dopesheet' | 'graph' | null => {
  if (scopeId === 'timeline.dopesheet') return 'dopesheet';
  if (scopeId === 'timeline.graph') return 'graph';
  return scopeId.startsWith('timeline') ? 'dopesheet' : null;
};

export const createBaseCommands = (): HotkeyCommand[] => [
  {
    id: 'editor.openToolsPanel',
    run: (context) => {
      const actions = getStudioActions(context);
      actions.setActiveTab(EditorTab.Tools);
      actions.setSubPanelVisible(true);
      return true;
    },
  },
  {
    id: 'history.undo',
    run: (context) => {
      const actions = getStudioActions(context);
      if (context.isDrawing) {
        actions.undoDrawingPoint();
      } else {
        actions.undo();
      }
      return true;
    },
  },
  {
    id: 'history.redo',
    run: (context) => {
      const actions = getStudioActions(context);
      if (context.isDrawing) {
        actions.redoDrawingPoint();
      } else {
        actions.redo();
      }
      return true;
    },
  },
  {
    id: 'viewer.activateSlot',
    run: (context, args) => {
      const slot = (args as { slot: number }).slot;
      const actions = getStudioActions(context);
      actions.activateViewerSlot(slot);
      return true;
    },
  },
  {
    id: 'viewer.assignSelectedToSlot',
    run: (context, args) => {
      if (!context.selectedViewerTargetId) {
        return false;
      }
      const slot = (args as { slot: number }).slot;
      const actions = getStudioActions(context);
      actions.assignViewerSlot(slot, context.selectedViewerTargetId);
      return true;
    },
  },
  {
    id: 'viewer.toggleAlphaOverlay',
    run: (context) => {
      const actions = getStudioActions(context);
      const viewerSettings = (
        context as HotkeyExecutionContext & { viewerSettings: ViewerSettings }
      ).viewerSettings;
      actions.setViewerSettings({ alphaOverlay: !viewerSettings.alphaOverlay });
      return true;
    },
  },
  {
    id: 'viewer.toggleChannelsAlpha',
    run: (context) => {
      const actions = getStudioActions(context);
      const viewerSettings = (
        context as HotkeyExecutionContext & { viewerSettings: ViewerSettings }
      ).viewerSettings;
      actions.setViewerSettings({ channels: viewerSettings.channels === 'A' ? 'RGB' : 'A' });
      return true;
    },
  },
  {
    id: 'viewer.toggleOverlays',
    run: (context) => {
      const actions = getStudioActions(context);
      const viewerSettings = (
        context as HotkeyExecutionContext & { viewerSettings: ViewerSettings }
      ).viewerSettings;
      actions.setViewerSettings({ showOverlays: !viewerSettings.showOverlays });
      return true;
    },
  },
  {
    id: 'viewport.toggleStabilize',
    run: (context) => {
      const actions = getStudioActions(context);
      actions.toggleStabilize();
      return true;
    },
  },
  {
    id: 'timeline.seekRelativeFrame',
    run: (context, args) => {
      const actions = getStudioActions(context);
      const delta = (args as { delta: number }).delta;
      actions.seekFrame(context.currentFrame + delta);
      return true;
    },
  },
  {
    id: 'timeline.togglePlayback',
    run: (context) => {
      const actions = getStudioActions(context);
      actions.playPause();
      return true;
    },
  },
  {
    id: 'timeline.seekVisibleKeyframe',
    run: (context, args) => {
      const direction = (args as { direction: 'next' | 'prev' }).direction;
      const frames = getVisibleKeyframeFrames(context.selectedNode, context.selectedRotoPathIds);
      const nextFrame =
        direction === 'prev'
          ? frames.filter((frame) => frame < context.currentFrame).pop()
          : frames.find((frame) => frame > context.currentFrame);

      if (nextFrame === undefined) {
        return false;
      }

      const actions = getStudioActions(context);
      actions.seekFrame(nextFrame);
      return true;
    },
  },
  {
    id: 'viewport.cancelDrawing',
    run: (context) => {
      if (!context.isDrawing) {
        return false;
      }
      const actions = getStudioActions(context);
      actions.cancelDrawingShape();
      if (context.activeViewportTool === 'bspline') {
        actions.setActiveViewportTool('select');
      }
      return true;
    },
  },
  {
    id: 'viewport.deleteRotoSelection',
    run: (context) => {
      if (context.selectedNodeType !== NodeType.ROTO || context.activeViewportTool === 'nudge') {
        return false;
      }
      const actions = getStudioActions(context);
      if (context.selectedRotoPointRefs.length > 0) {
        actions.deleteSelectedRotoPoints();
        return true;
      }
      if (context.selectedRotoPathIds.length > 0) {
        actions.deleteSelectedRotoShapes();
        return true;
      }
      return false;
    },
  },
  {
    id: 'viewport.selectAll',
    run: (context) => {
      const { selectedNode } = context;
      if (!selectedNode) {
        return false;
      }

      const actions = getStudioActions(context);

      if (selectedNode.type === NodeType.ROTO) {
        const rotoNode = selectedNode as RotoNode;
        actions.setSelectedRotoSelection({
          layerIds: rotoNode.layers.map((layer) => layer.id),
          pathIds: rotoNode.paths.map((path) => path.id),
        });
        return true;
      }

      if (selectedNode.type === NodeType.PAINT) {
        const paintNode = selectedNode as PaintNode;
        actions.setSelectedPaintLayerIds(paintNode.layers.map((layer) => layer.id));
        actions.setSelectedPaintStrokeIds(paintNode.strokes.map((stroke) => stroke.id));
        return true;
      }

      return false;
    },
  },
  {
    id: 'flow.deleteSelectedNode',
    run: (context) => {
      const selectedNodeId = context.selectedNodeId;
      const selectedNode = context.selectedNode;
      if (!selectedNodeId || !selectedNode) {
        return false;
      }

      if (nodeFlags(selectedNode.type).isProtected) {
        return false;
      }

      const actions = getStudioActions(context);
      actions.deleteNode(selectedNodeId);
      return true;
    },
  },
  {
    id: 'viewport.setActiveTool',
    run: (context, args) => {
      const tool = (args as { tool: string }).tool;
      const actions = getStudioActions(context);
      actions.setActiveViewportTool(tool);
      return true;
    },
  },
  {
    id: 'viewport.activateOrToggleRotoSelectMode',
    run: (context) => {
      const actions = getStudioActions(context);

      if (context.selectedNodeType !== NodeType.ROTO) {
        actions.setActiveViewportTool('select');
        return true;
      }

      if (context.activeViewportTool !== 'select') {
        actions.setActiveViewportTool('select');
        return true;
      }

      // Roto Select has two UX layers behind the same hotkey:
      // 1. point selection -> shape selection
      // 2. shape selection -> restore the most recent point subset for those same shapes
      // This keeps Q as a quick mode toggle without inventing a new point selection.
      if (context.selectedRotoPointRefs.length > 0) {
        const pathIds = Array.from(
          new Set(context.selectedRotoPointRefs.map((pointRef) => pointRef.pathId)),
        );
        actions.setSelectedRotoSelection({
          layerIds: [],
          pathIds,
        });
        return true;
      }

      if (context.selectedRotoPathIds.length > 0) {
        const recentPointRefs = getValidRotoPointRefs(
          context.selectedNode,
          context.selectedRotoPathIds,
          context.recentRotoPointRefs,
        );
        if (recentPointRefs.length > 0) {
          actions.setSelectedRotoSelection({
            layerIds: [],
            pathIds: context.selectedRotoPathIds,
            pointRefs: recentPointRefs,
          });
        }
        return true;
      }

      actions.setActiveViewportTool('select');
      return true;
    },
  },
];

export const baseBindings: HotkeyBinding[] = [
  { keys: 'Tab', command: 'editor.openToolsPanel', repeat: false },
  { keys: 'Mod+Z', command: 'history.undo' },
  { keys: 'Mod+Shift+Z', command: 'history.redo' },
  {
    keys: 'Mod+A',
    command: 'viewport.selectAll',
    scope: 'viewport',
    weight: 400,
  },
  {
    keys: 'Shift+A',
    command: 'viewer.toggleAlphaOverlay',
    scope: 'viewport',
    weight: 400,
  },
  {
    keys: 'A',
    command: 'viewer.toggleChannelsAlpha',
    scope: 'viewport',
    weight: 400,
  },
  { keys: '0', command: 'viewer.toggleOverlays', scope: 'viewport' },
  { keys: 'S', command: 'viewport.toggleStabilize', scope: 'viewport' },
  { keys: 'Escape', command: 'viewport.cancelDrawing', scope: 'viewport' },
  {
    keys: ['Delete', 'Backspace'],
    command: 'viewport.deleteRotoSelection',
    scope: 'viewport',
  },
  {
    keys: ['Delete', 'Backspace'],
    command: 'flow.deleteSelectedNode',
    scope: ['flow.list', 'flow.graph'],
    when: (context) => !!context.selectedNodeId && !!context.selectedNode,
  },
  { keys: 'Z', command: 'timeline.seekRelativeFrame', args: { delta: -1 } },
  { keys: 'X', command: 'timeline.seekRelativeFrame', args: { delta: 1 } },
  { keys: 'Space', command: 'timeline.togglePlayback', repeat: false, scope: 'timeline' },
  {
    keys: 'Shift+Z',
    command: 'timeline.seekVisibleKeyframe',
    args: { direction: 'prev' },
  },
  {
    keys: 'Shift+X',
    command: 'timeline.seekVisibleKeyframe',
    args: { direction: 'next' },
  },
  ...[1, 2, 3, 4].map<HotkeyBinding>((slot) => ({
    keys: `${slot}`,
    command: 'viewer.activateSlot',
    args: { slot },
  })),
  ...[1, 2, 3, 4].map<HotkeyBinding>((slot) => ({
    keys: `${slot}`,
    command: 'viewer.assignSelectedToSlot',
    args: { slot },
    scope: 'flow',
    when: (context) => context.selectedViewerTargetId !== null,
  })),
];

export const getEffectBindingsForSelection = (selectedNode: AnyNode | null): HotkeyBinding[] => {
  if (!selectedNode) {
    return [];
  }

  const definition = effectRegistry.get(selectedNode.type);
  if (!definition) {
    return [];
  }

  const explicitBindings = (definition.hotkeys ?? []).map<HotkeyBinding>((binding) => ({
    ...binding,
    weight: binding.weight ?? 300,
  }));
  const compatibilityBindings = Object.entries(definition.toolHotkeys ?? {}).map<HotkeyBinding>(
    ([keys, tool]) => ({
      args: { tool },
      command:
        selectedNode.type === NodeType.ROTO && tool === 'select'
          ? 'viewport.activateOrToggleRotoSelectMode'
          : 'viewport.setActiveTool',
      keys,
      scope: 'viewport',
      weight: 300,
    }),
  );

  return [...explicitBindings, ...compatibilityBindings];
};

export const StudioHotkeysProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const projectId = useEditorSelector((state) => state.projectId);
  const selectedNodeId = useEditorSelector((state) => state.selectedNodeId);
  const selectedRotoPathIds = useEditorSelector((state) => state.selectedRotoPathIds);
  const selectedRotoPointRefs = useEditorSelector((state) => state.selectedRotoPointRefs);
  const currentFrame = useEditorSelector((state) => state.currentFrame);
  const maxFrames = useEditorSelector((state) => state.maxFrames);
  const isDrawing = useEditorSelector((state) => state.isDrawing);
  const activeViewportTool = useEditorSelector((state) => state.activeViewportTool);
  const viewerSettings = useEditorSelector((state) => state.viewerSettings);
  const activeTab = useEditorSelector((state) => state.activeTab);
  const actions = useEditorActions();
  const { flowViewMode } = usePreferences();

  const selectedNode = useSelectedEditorNode() ?? null;

  const selectedViewerTargetId = useMemo(
    () => getSelectedViewerTargetId(selectedNode, selectedNodeId),
    [selectedNode, selectedNodeId],
  );
  // Ephemeral UX memory for Roto Select:
  // remember the last point subset only while the user stays on the same node + shape selection.
  // As soon as the selected shapes change, Q should no longer jump back into stale point mode.
  const recentRotoPointSelectionRef = React.useRef<{
    nodeId: string | null;
    pathKey: string;
    pointRefs: RotoPointRef[];
  }>({
    nodeId: null,
    pathKey: '',
    pointRefs: [],
  });

  const selectedRotoPathKey = useMemo(
    () => [...selectedRotoPathIds].sort().join(','),
    [selectedRotoPathIds],
  );

  React.useEffect(() => {
    if (selectedNode?.type !== NodeType.ROTO || !selectedNodeId) {
      recentRotoPointSelectionRef.current = { nodeId: null, pathKey: '', pointRefs: [] };
      return;
    }

    if (selectedRotoPointRefs.length > 0) {
      recentRotoPointSelectionRef.current = {
        nodeId: selectedNodeId,
        pathKey: selectedRotoPathKey,
        pointRefs: [...selectedRotoPointRefs],
      };
      return;
    }

    const recent = recentRotoPointSelectionRef.current;
    if (recent.nodeId !== selectedNodeId || recent.pathKey !== selectedRotoPathKey) {
      recentRotoPointSelectionRef.current = {
        nodeId: selectedNodeId,
        pathKey: selectedRotoPathKey,
        pointRefs: [],
      };
    }
  }, [selectedNode, selectedNodeId, selectedRotoPointRefs, selectedRotoPathKey]);

  const commands = useMemo(() => createBaseCommands(), []);
  const bindings = useMemo(
    () => (projectId ? [...baseBindings, ...getEffectBindingsForSelection(selectedNode)] : []),
    [projectId, selectedNode],
  );
  const activeTextSelectionScopeRef = React.useRef<HTMLElement | null>(null);
  const isClampingSelectionRef = React.useRef(false);

  React.useEffect(() => {
    const root = document.getElementById('root');
    if (!root) {
      return;
    }

    const handleWheelCapture = (event: WheelEvent) => {
      if (shouldPreventBrowserZoomGesture(event, root)) {
        event.preventDefault();
      }
    };

    const handleDragStartCapture = (event: DragEvent) => {
      if (shouldPreventNativeDragOrSelection(event.target, root)) {
        event.preventDefault();
      }
    };

    const handlePointerDownCapture = (event: PointerEvent) => {
      if (!isWithinRoot(event.target, root)) {
        activeTextSelectionScopeRef.current = null;
        return;
      }

      activeTextSelectionScopeRef.current = isSelectableTextTarget(event.target)
        ? getTextSelectionScope(event.target)
        : null;
    };

    const handleSelectStartCapture = (event: Event) => {
      if (shouldPreventNativeDragOrSelection(event.target, root)) {
        event.preventDefault();
        activeTextSelectionScopeRef.current = null;
        return;
      }

      activeTextSelectionScopeRef.current = getTextSelectionScope(event.target);
    };

    const handleSelectionChange = () => {
      if (isClampingSelectionRef.current) {
        return;
      }

      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return;
      }

      const activeScope = activeTextSelectionScopeRef.current;
      if (!activeScope || !root.contains(activeScope)) {
        return;
      }

      if (
        selection.anchorNode &&
        activeScope.contains(selection.anchorNode) &&
        selection.focusNode &&
        activeScope.contains(selection.focusNode)
      ) {
        return;
      }

      isClampingSelectionRef.current = true;
      try {
        clampSelectionToScope(selection, activeScope);
      } finally {
        isClampingSelectionRef.current = false;
      }
    };

    const handleKeyDownCapture = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== 'a' ||
        (!event.ctrlKey && !event.metaKey) ||
        isTextEntryTarget(event.target)
      ) {
        return;
      }

      const activeScope =
        (isWithinRoot(event.target, root) && getTextSelectionScope(event.target)) ||
        activeTextSelectionScopeRef.current;
      if (!activeScope || !root.contains(activeScope)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      activeTextSelectionScopeRef.current = activeScope;
      selectTextSelectionScope(activeScope);
    };

    window.addEventListener('wheel', handleWheelCapture, {
      capture: true,
      passive: false,
    });
    document.addEventListener('pointerdown', handlePointerDownCapture, true);
    document.addEventListener('dragstart', handleDragStartCapture, true);
    document.addEventListener('selectstart', handleSelectStartCapture, true);
    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('keydown', handleKeyDownCapture, true);

    return () => {
      window.removeEventListener('wheel', handleWheelCapture, true);
      document.removeEventListener('pointerdown', handlePointerDownCapture, true);
      document.removeEventListener('dragstart', handleDragStartCapture, true);
      document.removeEventListener('selectstart', handleSelectStartCapture, true);
      document.removeEventListener('selectionchange', handleSelectionChange);
      document.removeEventListener('keydown', handleKeyDownCapture, true);
    };
  }, []);

  const buildContext = useCallback(
    ({
      keyboard,
      target,
      isTextEntry,
    }: {
      keyboard: KeyboardSnapshot;
      target: EventTarget | null;
      isTextEntry: boolean;
    }): HotkeyExecutionContext & { viewerSettings: ViewerSettings } => ({
      actions,
      activeScopeId: keyboard.activeScopeId,
      activeScopePath: keyboard.activeScopePath,
      activeTab,
      activeView: getActiveView(keyboard.activeScopeId),
      activeViewportTool,
      currentFrame,
      flowMode: getFlowMode(keyboard.activeScopeId, flowViewMode),
      isDrawing,
      isTextEntry,
      keyboard,
      maxFrames,
      modifiers: keyboard.modifiers,
      selectedNode,
      selectedNodeId,
      selectedNodeType: selectedNode?.type ?? null,
      selectedRotoPathIds,
      selectedRotoPointRefs,
      recentRotoPointRefs:
        recentRotoPointSelectionRef.current.nodeId === selectedNodeId &&
        recentRotoPointSelectionRef.current.pathKey === selectedRotoPathKey
          ? recentRotoPointSelectionRef.current.pointRefs
          : [],
      selectedViewerTargetId,
      target,
      timelineMode: getTimelineMode(keyboard.activeScopeId),
      viewerSettings,
      viewerSlot: null,
    }),
    [
      actions,
      activeTab,
      activeViewportTool,
      currentFrame,
      flowViewMode,
      isDrawing,
      maxFrames,
      selectedNode,
      selectedNodeId,
      selectedRotoPathIds,
      selectedRotoPathKey,
      selectedRotoPointRefs,
      selectedViewerTargetId,
      viewerSettings,
    ],
  );

  return (
    <HotkeyProvider baseBindings={bindings} baseCommands={commands} buildContext={buildContext}>
      {children}
    </HotkeyProvider>
  );
};
