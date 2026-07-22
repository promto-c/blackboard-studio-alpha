import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { ComfyNode, ComfyWorkflow, EditorTab, GroupNode, NodeType } from '@blackboard/types';
import { SplitControl, SplitControlAction, SplitterHandle, StyledDropdown } from '@blackboard/ui';
import { FlowViewModeControls } from '@/components/FlowViewModeControls';
import { NodeItemsPanel, getNodeItemsComponent } from '@/components/NodeItemsPanel';
import { SlidingSegmentedControl } from '@/components/SlidingSegmentedControl';
import {
  SegmentedControl,
  SegmentedControlAction,
  SegmentedControlButton,
} from '@/components/SegmentedControl';
import { useSelectedEditorNode } from '@/hooks/useEditorNodes';
import { useProjectSyncStatus } from '@/hooks/useProjectSyncStatus';
import { usePreferences } from '@/state/preferencesContext';
import { usePreferencesNavigation } from '@/features/projects/preferencesNavigation';
import { pullProjectFromRemote, pushProjectToRemote } from '@blackboard/project-store';
import { getErrorMessage } from '@/utils/guards';
import {
  EditorSubPanelWidth,
  EditorSubPanelHeight,
  EditorItemsPanelPercent,
  clampEditor,
} from '@/utils/editorLayout';
import {
  useAutoSyncRotoInspectorLevel,
  type RotoInspectorLevel,
} from '@/hooks/useAutoSyncRotoInspectorLevel';
import ToolsTab from './ToolsTab';
import HistoryTab from './HistoryTab';
import FlowTab, { type ActiveComfyGraph } from '@/features/nodes/FlowTab';
import PropertiesTab from './PropertiesTab';
import ChatsTab from './ChatsTab';
import GalleryTab from './GalleryTab';
import {
  areNativeGroupPathsEqual,
  getRecentNativeGroupBreadcrumbPath,
  type NativeGroupPathItem,
} from './nativeGroupBreadcrumb';
import { getSelectedNodeIdsForGrouping } from '@/state/editor/flowModel';
import * as Icons from '@blackboard/icons';

interface PanelProps {
  isMobilePortrait: boolean;
}

type DesktopSubPanelTab = EditorTab.Props | EditorTab.Gallery | EditorTab.Chats | EditorTab.History;
type DesktopPanelTabItem = {
  tab: DesktopSubPanelTab;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
};

const MAIN_FLOW_MIN_WIDTH = 260;
const LIST_SUB_PANEL_VERTICAL_BREAKPOINT = MAIN_FLOW_MIN_WIDTH + EditorSubPanelWidth.MIN;
const FLOW_HEADER_CLASS =
  'sticky top-0 z-40 flex items-center gap-2 border-b border-white/10 bg-gray-900/35 px-2 backdrop-blur-md supports-[backdrop-filter]:bg-gray-900/20';
const FLOW_BREADCRUMB_CLASS =
  '-ml-[3px] flex min-w-0 items-center gap-0.5 rounded-md border border-white/10 bg-black/20 p-0.5';
const FLOW_BREADCRUMB_BUTTON_CLASS =
  'inline-flex min-w-0 items-center gap-1 rounded px-1 py-1 transition-colors';
const DESKTOP_PANEL_TABS: DesktopPanelTabItem[] = [
  { tab: EditorTab.Props, label: 'Props', Icon: Icons.Cog },
  { tab: EditorTab.Chats, label: 'Chats', Icon: Icons.ChatBubble },
  { tab: EditorTab.Gallery, label: 'Gallery', Icon: Icons.Photo },
  { tab: EditorTab.History, label: 'History', Icon: Icons.RotateLoop },
];
const DESKTOP_PANEL_ACTIVE_TAB_WIDTH = 68;
const DESKTOP_PANEL_INACTIVE_TAB_WIDTH = 28;
const DESKTOP_PANEL_TAB_GAP = 2;
const DESKTOP_HEADER_CONTROL_HEIGHT = 28;

const clampValue = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function ProjectBranchSwitcher({ compact = false }: { compact?: boolean }) {
  const projectId = useEditorSelector((state) => state.projectId);
  const projectBranches = useEditorSelector((state) => state.projectBranches);
  const activeProjectBranchId = useEditorSelector((state) => state.activeProjectBranchId);
  const {
    createProjectBranch,
    deleteProjectBranch,
    switchProjectBranch,
    flushProjectSave,
    loadProject,
  } = useEditorActions();
  const { openPreferences } = usePreferencesNavigation();
  const { status: projectSyncStatus, refresh: refreshProjectSyncStatus } =
    useProjectSyncStatus(projectId);
  const activeBranch = projectBranches.find((branch) => branch.id === activeProjectBranchId);
  const [isBusy, setBusy] = useState(false);
  const [syncDirection, setSyncDirection] = useState<'pull' | 'push' | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const isRemoteTracking = projectSyncStatus?.binding?.mode === 'local-clone';
  const isSyncBusy = syncDirection !== null;
  const needsSyncResolution =
    projectSyncStatus?.state === 'diverged' ||
    projectSyncStatus?.state === 'offline' ||
    Boolean(syncError);
  const canPull = projectSyncStatus?.state === 'remote-ahead';
  const canPush = projectSyncStatus?.state === 'local-ahead';
  const availableSyncDirection: 'pull' | 'push' | null = canPull ? 'pull' : canPush ? 'push' : null;

  const openProjectStorage = () => openPreferences({ section: 'storage', colorScope: 'project' });

  const handleRemoteSync = async (direction: 'pull' | 'push') => {
    if (!projectId || isSyncBusy) return;
    if (needsSyncResolution) {
      openProjectStorage();
      return;
    }
    if ((direction === 'pull' && !canPull) || (direction === 'push' && !canPush)) return;

    setSyncDirection(direction);
    setSyncError(null);
    try {
      await flushProjectSave?.();
      if (direction === 'pull') {
        await pullProjectFromRemote(projectId);
        await loadProject(projectId);
      } else {
        await pushProjectToRemote(projectId);
      }
      await refreshProjectSyncStatus();
    } catch (error) {
      console.error(`Could not ${direction} project remote:`, error);
      setSyncError(getErrorMessage(error, `Could not ${direction} project remote.`));
    } finally {
      setSyncDirection(null);
    }
  };

  const getSyncActionTitle = (): string => {
    if (syncError) return `${syncError} Open project storage settings.`;
    if (projectSyncStatus?.state === 'diverged') {
      return 'Local and remote changed. Open project storage settings to resolve.';
    }
    if (projectSyncStatus?.state === 'offline') {
      return 'Project remote is offline. Open project storage settings to reconnect.';
    }
    if (canPull) return 'Pull remote project changes into this Browser working copy';
    if (canPush) return 'Push the saved project snapshot, including all branches';
    return 'Local and remote project are up to date';
  };

  const handleSyncAction = () => {
    if (needsSyncResolution) {
      openProjectStorage();
      return;
    }
    if (availableSyncDirection) void handleRemoteSync(availableSyncDirection);
  };

  const handleSwitchBranch = async (branchId: string) => {
    if (!projectId || branchId === activeProjectBranchId || isBusy) return;

    setBusy(true);
    try {
      await switchProjectBranch(branchId);
    } catch (error) {
      console.error('Could not switch project branch:', error);
      window.alert('Could not switch branch.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateBranch = async (requestedName: string) => {
    const branchName = requestedName.trim();
    const branchExists = projectBranches.some(
      (branch) => branch.name.toLocaleLowerCase() === branchName.toLocaleLowerCase(),
    );
    if (!projectId || !branchName || branchExists || isBusy) return;

    setBusy(true);
    try {
      await createProjectBranch(branchName);
    } catch (error) {
      console.error('Could not create project branch:', error);
      window.alert('Could not create branch.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteBranch = async (branchId: string, branchName: string) => {
    if (!projectId || branchId === 'main' || isBusy) return;

    const confirmed = window.confirm(`Delete branch "${branchName}"? This cannot be undone.`);
    if (!confirmed) return;

    setBusy(true);
    try {
      await deleteProjectBranch(branchId);
    } catch (error) {
      console.error('Could not delete project branch:', error);
      window.alert('Could not delete branch.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setSyncError(null);
  }, [projectId]);

  useEffect(() => {
    if (projectSyncStatus?.state === 'up-to-date') setSyncError(null);
  }, [projectSyncStatus?.state]);

  if (!projectId) return null;

  const syncActionTitle = getSyncActionTitle();
  const SyncActionIcon = needsSyncResolution
    ? Icons.ExclamationCircle
    : availableSyncDirection === 'pull'
      ? Icons.ArrowDown
      : availableSyncDirection === 'push'
        ? Icons.ArrowUp
        : Icons.RotateLoop;
  const branchOptions = projectBranches.map((branch) => ({
    value: branch.id,
    label: branch.name,
    icon: <Icons.Branch className="h-3.5 w-3.5 text-primary-300" />,
    badges: branch.kind === 'agent' ? ['agent'] : undefined,
    trailingAction:
      branch.id === 'main'
        ? undefined
        : {
            label: `Delete branch ${branch.name}`,
            icon: <Icons.Trash className="h-3.5 w-3.5" />,
            tone: 'danger' as const,
            onSelect: () => void handleDeleteBranch(branch.id, branch.name),
          },
  }));
  const createOption = {
    isAvailable: (branchName: string) =>
      !projectBranches.some(
        (branch) => branch.name.toLocaleLowerCase() === branchName.toLocaleLowerCase(),
      ),
    label: (branchName: string) => `Create branch "${branchName}"`,
    icon: <Icons.Branch className="h-3.5 w-3.5" />,
    onCreate: (branchName: string) => void handleCreateBranch(branchName),
  };
  const branchDropdown = (
    <StyledDropdown
      value={activeBranch?.id ?? 'main'}
      options={branchOptions}
      onChange={(branchId) => void handleSwitchBranch(String(branchId))}
      density="toolbar"
      widthClass="w-max"
      popoverWidthClass="w-64"
      searchable
      searchPlaceholder="Find or create branch"
      createOption={createOption}
      showSelectedBadges={false}
      disabled={isBusy || isSyncBusy}
    />
  );
  const switcherWidthClass = compact ? 'max-w-48' : 'max-w-72';

  if (!isRemoteTracking) {
    return <div className={`${switcherWidthClass} min-w-0 shrink`}>{branchDropdown}</div>;
  }

  return (
    <SplitControl density="toolbar" className={`${switcherWidthClass} min-w-0 shrink`}>
      <div className="min-w-0 max-w-full shrink overflow-hidden">{branchDropdown}</div>
      <SplitControlAction
        onClick={handleSyncAction}
        disabled={isBusy || isSyncBusy || (!availableSyncDirection && !needsSyncResolution)}
        title={syncActionTitle}
        aria-label={syncActionTitle}
        className={`disabled:cursor-default disabled:text-gray-700 ${
          needsSyncResolution
            ? syncError
              ? '!text-red-300 hover:bg-red-500/10'
              : '!text-amber-300 hover:bg-amber-500/10'
            : availableSyncDirection
              ? '!text-primary-200 hover:bg-primary-500/10'
              : '!text-gray-700'
        }`}
      >
        {syncDirection ? (
          <Icons.RotateLoop className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <SyncActionIcon className="h-3.5 w-3.5" />
        )}
      </SplitControlAction>
    </SplitControl>
  );
}

function Panel({ isMobilePortrait }: PanelProps) {
  const activeTab = useEditorSelector((s) => s.activeTab);
  const isSubPanelVisible = useEditorSelector((s) => s.isSubPanelVisible);
  const nodes = useEditorSelector((s) => s.nodes);
  const flows = useEditorSelector((s) => s.flows);
  const rootFlowId = useEditorSelector((s) => s.rootFlowId);
  const activeFlowId = useEditorSelector((s) => s.activeFlowId);
  const selectedNodeId = useEditorSelector((s) => s.selectedNodeId);
  const selectedNodeIds = useEditorSelector((s) => s.selectedNodeIds ?? []);
  const {
    flowListDirection,
    flowViewMode,
    setPreferences,
    uiStyle,
    editorSubPanelWidth,
    editorSubPanelHeight,
    editorItemsPanelPercent,
  } = usePreferences();
  const {
    setActiveTab,
    setSubPanelVisible,
    closeProject,
    autoArrangeNodes,
    openFlow,
    openGroupNode,
    groupSelectedNodes,
  } = useEditorActions();
  const panelContentRef = useRef<HTMLDivElement>(null);
  const propsItemsSplitRef = useRef<HTMLDivElement>(null);
  const addToolsButtonRef = useRef<HTMLButtonElement>(null);
  const toolsPopupRef = useRef<HTMLDivElement>(null);
  const [panelContentSize, setPanelContentSize] = useState({ width: 0, height: 0 });
  const [subPanelWidth, setSubPanelWidth] = useState(() =>
    clampEditor(editorSubPanelWidth, EditorSubPanelWidth),
  );
  const [subPanelHeight, setSubPanelHeight] = useState(() =>
    clampEditor(editorSubPanelHeight, EditorSubPanelHeight),
  );
  const [itemsPanelPercent, setItemsPanelPercent] = useState(() =>
    clampEditor(editorItemsPanelPercent, EditorItemsPanelPercent),
  );
  const [rotoInspectorLevel, setRotoInspectorLevel] = useState<RotoInspectorLevel>('node');
  const [activeComfyGraph, setActiveComfyGraph] = useState<ActiveComfyGraph | null>(null);
  const [nativeGroupBreadcrumbPath, setNativeGroupBreadcrumbPath] = useState<NativeGroupPathItem[]>(
    [],
  );
  const hierarchySelections = useEditorSelector((s) => s.hierarchySelections);
  const selectedNode = useSelectedEditorNode();
  const activeComfyWorkflow = useMemo((): {
    node: ComfyNode;
    workflow: ComfyWorkflow;
  } | null => {
    if (!activeComfyGraph) return null;
    const comfyNode = nodes.find(
      (node): node is ComfyNode =>
        node.id === activeComfyGraph.nodeId && node.type === NodeType.COMFY,
    );
    const workflow =
      comfyNode?.workflows.find((candidate) => candidate.id === activeComfyGraph.workflowId) ??
      null;
    if (!comfyNode || !workflow?.sourceGraph) return null;
    return { node: comfyNode, workflow };
  }, [activeComfyGraph, nodes]);
  const activeComfySubgraphPath = activeComfyGraph?.subgraphPath ?? [];
  const activeComfySubgraphDepth = Math.min(
    activeComfyGraph?.subgraphDepth ?? activeComfySubgraphPath.length,
    activeComfySubgraphPath.length,
  );
  const currentComfyGraphDepth = Math.max(-1, activeComfySubgraphDepth);
  const nativeGroupPath = useMemo(() => {
    if (!rootFlowId || !activeFlowId || rootFlowId === activeFlowId) return [];

    const visit = (
      flowId: string,
      path: NativeGroupPathItem[],
      seen: Set<string>,
    ): NativeGroupPathItem[] | null => {
      if (flowId === activeFlowId) return path;
      if (seen.has(flowId)) return null;
      seen.add(flowId);

      const flow = flows[flowId];
      if (!flow) return null;

      for (const node of flow.nodes) {
        if (node.type !== NodeType.GROUP) continue;
        const group = node as GroupNode;
        if (!group.childFlowId) continue;

        const result = visit(
          group.childFlowId,
          [...path, { flowId: group.childFlowId, nodeId: group.id, name: group.name }],
          seen,
        );
        if (result) return result;
      }

      return null;
    };

    return visit(rootFlowId, [], new Set()) ?? [];
  }, [activeFlowId, flows, rootFlowId]);
  const shouldPreserveNativeGroupRecentPath = !selectedNodeId && selectedNodeIds.length === 0;
  const activeNativeGroupBreadcrumbPath = useMemo(
    () =>
      getRecentNativeGroupBreadcrumbPath(
        nativeGroupPath,
        nativeGroupBreadcrumbPath,
        flows,
        rootFlowId,
        { preserveRecentPath: shouldPreserveNativeGroupRecentPath },
      ),
    [
      flows,
      nativeGroupBreadcrumbPath,
      nativeGroupPath,
      rootFlowId,
      shouldPreserveNativeGroupRecentPath,
    ],
  );
  useEffect(() => {
    setNativeGroupBreadcrumbPath((current) => {
      const nextPath = getRecentNativeGroupBreadcrumbPath(
        nativeGroupPath,
        current,
        flows,
        rootFlowId,
        { preserveRecentPath: shouldPreserveNativeGroupRecentPath },
      );
      return areNativeGroupPathsEqual(current, nextPath) ? current : nextPath;
    });
  }, [flows, nativeGroupPath, rootFlowId, shouldPreserveNativeGroupRecentPath]);
  const currentNativeGroupDepth =
    nativeGroupPath.length > 0
      ? nativeGroupPath.length
      : activeFlowId === rootFlowId && activeNativeGroupBreadcrumbPath.length > 0
        ? -1
        : 0;
  const isNativeGroupBreadcrumbVisible = activeNativeGroupBreadcrumbPath.length > 0;
  const openNativeGroupBreadcrumbDepth = useCallback(
    (depth: number) => {
      if (depth <= 0) {
        if (rootFlowId) {
          openFlow(rootFlowId);
        }
        return;
      }

      const target = activeNativeGroupBreadcrumbPath[depth - 1];
      if (target) {
        openFlow(target.flowId);
      }
    },
    [activeNativeGroupBreadcrumbPath, openFlow, rootFlowId],
  );
  const isSingleSelectedNode =
    !!selectedNode &&
    (selectedNodeIds.length === 0 ||
      (selectedNodeIds.length === 1 && selectedNodeIds[0] === selectedNode.id));
  const selectedGroupNode =
    isSingleSelectedNode && selectedNode?.type === NodeType.GROUP
      ? (selectedNode as GroupNode)
      : null;
  const canGroupSelection = getSelectedNodeIdsForGrouping(nodes, selectedNodeIds).length > 0;
  const selectedComfyWorkflow = useMemo((): {
    node: ComfyNode;
    workflow: ComfyWorkflow;
  } | null => {
    if (!isSingleSelectedNode) return null;
    if (!selectedNode || selectedNode.type !== NodeType.COMFY) return null;
    const comfyNode = selectedNode as ComfyNode;
    const workflow =
      comfyNode.workflows.find((candidate) => candidate.id === comfyNode.selectedWorkflowId) ??
      null;
    if (!workflow?.sourceGraph) return null;
    return { node: comfyNode, workflow };
  }, [isSingleSelectedNode, selectedNode]);
  const openSelectedComfyGraph = useCallback(() => {
    if (!selectedComfyWorkflow) return;
    setPreferences({ flowViewMode: 'graph' });
    setActiveComfyGraph({
      nodeId: selectedComfyWorkflow.node.id,
      workflowId: selectedComfyWorkflow.workflow.id,
      subgraphPath: [],
      subgraphDepth: 0,
    });
  }, [selectedComfyWorkflow, setPreferences]);
  const setActiveComfySubgraphDepth = useCallback(
    (subgraphDepth: number) => {
      if (!activeComfyGraph) return;
      setActiveComfyGraph({
        ...activeComfyGraph,
        subgraphDepth: Math.max(-1, Math.min(subgraphDepth, activeComfySubgraphPath.length)),
      });
    },
    [activeComfyGraph, activeComfySubgraphPath.length, setActiveComfyGraph],
  );
  const openRootFlowBreadcrumb = useCallback(() => {
    if (activeComfyWorkflow && activeNativeGroupBreadcrumbPath.length === 0) {
      setActiveComfySubgraphDepth(-1);
      return;
    }

    setActiveComfyGraph(null);
    openNativeGroupBreadcrumbDepth(0);
  }, [
    activeComfyWorkflow,
    activeNativeGroupBreadcrumbPath.length,
    openNativeGroupBreadcrumbDepth,
    setActiveComfyGraph,
    setActiveComfySubgraphDepth,
  ]);
  const openNativeGroupBreadcrumbFromComposedPath = useCallback(
    (depth: number) => {
      if (activeComfyWorkflow) {
        setActiveComfySubgraphDepth(-1);
      }
      openNativeGroupBreadcrumbDepth(depth);
    },
    [activeComfyWorkflow, openNativeGroupBreadcrumbDepth, setActiveComfySubgraphDepth],
  );
  const resolveDesktopSubPanelTab = useCallback((tab: EditorTab): DesktopSubPanelTab => {
    if (tab === EditorTab.History) return EditorTab.History;
    if (tab === EditorTab.Chats) return EditorTab.Chats;
    if (tab === EditorTab.Gallery) return EditorTab.Gallery;
    return EditorTab.Props;
  }, []);
  useAutoSyncRotoInspectorLevel({
    selectedNode,
    hierarchySelections,
    selectedNodeId,
    setRotoInspectorLevel,
  });
  useEffect(() => {
    if (activeComfyGraph && !activeComfyWorkflow) {
      setActiveComfyGraph(null);
    }
  }, [activeComfyGraph, activeComfyWorkflow]);
  useEffect(() => {
    if (flowViewMode !== 'graph' && activeComfyGraph) {
      setActiveComfyGraph(null);
    }
  }, [activeComfyGraph, flowViewMode]);
  const initialDesktopSubPanelTab: DesktopSubPanelTab = resolveDesktopSubPanelTab(activeTab);
  const [desktopSubPanelTab, setDesktopSubPanelTab] =
    useState<DesktopSubPanelTab>(initialDesktopSubPanelTab);
  const [isDesktopSubPanelOpen, setDesktopSubPanelOpen] = useState(
    activeTab === EditorTab.Tools ? false : isSubPanelVisible,
  );
  const [isDesktopToolsPopupOpen, setDesktopToolsPopupOpen] = useState(false);

  useEffect(() => {
    const nextSubPanelWidth = clampEditor(editorSubPanelWidth, EditorSubPanelWidth);
    setSubPanelWidth((current) => (current === nextSubPanelWidth ? current : nextSubPanelWidth));
  }, [editorSubPanelWidth]);

  useEffect(() => {
    const nextSubPanelHeight = clampEditor(editorSubPanelHeight, EditorSubPanelHeight);
    setSubPanelHeight((current) => (current === nextSubPanelHeight ? current : nextSubPanelHeight));
  }, [editorSubPanelHeight]);

  useEffect(() => {
    const nextItemsPanelPercent = clampEditor(editorItemsPanelPercent, EditorItemsPanelPercent);
    setItemsPanelPercent((current) =>
      current === nextItemsPanelPercent ? current : nextItemsPanelPercent,
    );
  }, [editorItemsPanelPercent]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const nextPrefs: Partial<{
        editorSubPanelWidth: number;
        editorSubPanelHeight: number;
        editorItemsPanelPercent: number;
      }> = {};
      const nextSubPanelWidth = clampEditor(subPanelWidth, EditorSubPanelWidth);
      const nextSubPanelHeight = clampEditor(subPanelHeight, EditorSubPanelHeight);
      const nextItemsPanelPercent = clampEditor(itemsPanelPercent, EditorItemsPanelPercent);

      if (nextSubPanelWidth !== editorSubPanelWidth) {
        nextPrefs.editorSubPanelWidth = nextSubPanelWidth;
      }
      if (nextSubPanelHeight !== editorSubPanelHeight) {
        nextPrefs.editorSubPanelHeight = nextSubPanelHeight;
      }
      if (nextItemsPanelPercent !== editorItemsPanelPercent) {
        nextPrefs.editorItemsPanelPercent = nextItemsPanelPercent;
      }

      if (Object.keys(nextPrefs).length > 0) {
        setPreferences(nextPrefs);
      }
    }, 150);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    editorItemsPanelPercent,
    editorSubPanelHeight,
    editorSubPanelWidth,
    itemsPanelPercent,
    setPreferences,
    subPanelHeight,
    subPanelWidth,
  ]);

  const setFlowViewMode = useCallback(
    (mode: 'list' | 'graph') => setPreferences({ flowViewMode: mode }),
    [setPreferences],
  );

  const handleToggleFlowDirection = useCallback(() => {
    setPreferences({
      flowListDirection: flowListDirection === 'bottom-up' ? 'top-down' : 'bottom-up',
    });
  }, [flowListDirection, setPreferences]);

  useEffect(() => {
    if (isMobilePortrait) {
      setDesktopToolsPopupOpen(false);
      return;
    }

    if (activeTab === EditorTab.Tools) {
      setDesktopToolsPopupOpen(true);
      return;
    }

    setDesktopSubPanelTab(resolveDesktopSubPanelTab(activeTab));
    setDesktopSubPanelOpen(isSubPanelVisible);
    setDesktopToolsPopupOpen(false);
  }, [activeTab, isMobilePortrait, isSubPanelVisible, resolveDesktopSubPanelTab]);

  const renderMobileTabContent = () => {
    switch (activeTab) {
      case EditorTab.Tools:
        return <ToolsTab />;
      case EditorTab.History:
        return <HistoryTab />;
      case EditorTab.Chats:
        return <ChatsTab />;
      case EditorTab.Gallery:
        return <GalleryTab />;
      case EditorTab.Flow:
        return <FlowTab />;
      default:
        return (
          <div className="p-4 text-center text-gray-500">
            <p>Select a tab above to get started.</p>
          </div>
        );
    }
  };

  const renderDesktopSubPanelContent = () => {
    switch (desktopSubPanelTab) {
      case EditorTab.History:
        return <HistoryTab />;
      case EditorTab.Chats:
        return <ChatsTab />;
      case EditorTab.Gallery:
        return <GalleryTab />;
      case EditorTab.Props:
      default:
        return (
          <PropertiesTab
            rotoInspectorLevel={rotoInspectorLevel}
            onRotoInspectorLevelChange={setRotoInspectorLevel}
          />
        );
    }
  };

  const syncDesktopSubPanelState = useCallback(
    (tab: DesktopSubPanelTab, visible: boolean) => {
      setDesktopSubPanelTab(tab);
      setDesktopSubPanelOpen(visible);
      setActiveTab(tab);
      setSubPanelVisible(visible);
    },
    [setActiveTab, setSubPanelVisible],
  );

  const closeToolsPopup = useCallback(() => {
    setDesktopToolsPopupOpen(false);
    setActiveTab(desktopSubPanelTab);
    setSubPanelVisible(isDesktopSubPanelOpen);
  }, [desktopSubPanelTab, isDesktopSubPanelOpen, setActiveTab, setSubPanelVisible]);

  const openSubPanel = (tab: DesktopSubPanelTab) => {
    const nextVisible = tab === desktopSubPanelTab ? !isDesktopSubPanelOpen : true;
    syncDesktopSubPanelState(tab, nextVisible);
  };

  const toggleToolsPopup = () => {
    if (isDesktopToolsPopupOpen) {
      closeToolsPopup();
      return;
    }

    setDesktopToolsPopupOpen(true);
    setActiveTab(EditorTab.Tools);
  };

  const isListView = flowViewMode === 'list';
  const shouldReserveSubPanelArea = isDesktopSubPanelOpen && isListView;
  const panelContentWidth = panelContentSize.width;
  const panelContentHeight = panelContentSize.height;
  const shouldStackSubPanelVertically =
    shouldReserveSubPanelArea && panelContentWidth < LIST_SUB_PANEL_VERTICAL_BREAKPOINT;
  const toolsPopupWidthClass = 'w-[46%] min-w-[260px] max-w-[560px]';
  const horizontalSubPanelMaxWidth =
    panelContentWidth > 0
      ? Math.max(
          EditorSubPanelWidth.MIN,
          Math.min(EditorSubPanelWidth.MAX, panelContentWidth - MAIN_FLOW_MIN_WIDTH),
        )
      : EditorSubPanelWidth.MAX;
  const verticalSubPanelMaxHeight =
    panelContentHeight > 0
      ? Math.max(
          EditorSubPanelHeight.MIN,
          Math.min(EditorSubPanelHeight.MAX, panelContentHeight - EditorSubPanelHeight.MIN),
        )
      : EditorSubPanelHeight.MAX;
  const clampedSubPanelWidth = clampValue(
    subPanelWidth,
    EditorSubPanelWidth.MIN,
    horizontalSubPanelMaxWidth,
  );
  const clampedSubPanelHeight = clampValue(
    subPanelHeight,
    EditorSubPanelHeight.MIN,
    verticalSubPanelMaxHeight,
  );
  const clampedItemsPanelPercent = clampValue(
    itemsPanelPercent,
    EditorItemsPanelPercent.MIN,
    EditorItemsPanelPercent.MAX,
  );
  const flowContentSizeClass =
    flowViewMode === 'graph'
      ? 'h-[calc(100%+2.5rem)]'
      : shouldStackSubPanelVertically
        ? 'min-h-[160px]'
        : 'h-full';
  const flowContentTopClass = flowViewMode === 'graph' ? '-mt-10 pt-2' : 'pt-2';
  const splitLayoutClass = shouldReserveSubPanelArea
    ? shouldStackSubPanelVertically
      ? 'flex flex-col'
      : 'flex'
    : '';
  const graphFitInsetRight =
    flowViewMode === 'graph' && isDesktopSubPanelOpen && !shouldReserveSubPanelArea
      ? clampedSubPanelWidth
      : 0;

  useEffect(() => {
    const element = panelContentRef.current;
    if (!element) return;

    setPanelContentSize({ width: element.clientWidth, height: element.clientHeight });

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setPanelContentSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!panelContentWidth) return;
    if (subPanelWidth > horizontalSubPanelMaxWidth) {
      setSubPanelWidth(horizontalSubPanelMaxWidth);
    }
  }, [horizontalSubPanelMaxWidth, panelContentWidth, subPanelWidth]);

  useEffect(() => {
    if (!panelContentHeight) return;
    if (subPanelHeight > verticalSubPanelMaxHeight) {
      setSubPanelHeight(verticalSubPanelMaxHeight);
    }
  }, [panelContentHeight, subPanelHeight, verticalSubPanelMaxHeight]);

  useEffect(() => {
    if (isMobilePortrait || !isDesktopToolsPopupOpen) return;

    const handlePointerDownCapture = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (addToolsButtonRef.current?.contains(target) || toolsPopupRef.current?.contains(target)) {
        return;
      }
      closeToolsPopup();
    };

    document.addEventListener('pointerdown', handlePointerDownCapture, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownCapture, true);
    };
  }, [closeToolsPopup, isDesktopToolsPopupOpen, isMobilePortrait]);

  const glassPanelClass = `relative isolate overflow-hidden rounded-xl border shadow-[0_10px_30px_rgba(0,0,0,0.35)] pointer-events-auto ${
    uiStyle === 'solid'
      ? 'border-gray-700 bg-gray-900 ring-1 ring-inset ring-white/5'
      : 'border-white/10 ring-1 ring-inset ring-white/10'
  }`;
  const glassPanelBackdropClass =
    uiStyle === 'solid'
      ? 'absolute inset-0 bg-gray-900'
      : 'absolute inset-0 rounded-[inherit] bg-gray-900/45 backdrop-blur-lg supports-[backdrop-filter]:bg-gray-900/28';

  const renderGlassPanelSurface = (
    className: string,
    children: React.ReactNode,
    style?: React.CSSProperties,
  ) => (
    <div className={`${glassPanelClass} ${className}`} style={style}>
      <div aria-hidden="true" className={glassPanelBackdropClass} />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );

  const renderDesktopSubPanel = (layout: 'floating' | 'horizontal' | 'vertical') => {
    const subPanelLabel =
      desktopSubPanelTab === EditorTab.History
        ? 'History'
        : desktopSubPanelTab === EditorTab.Chats
          ? 'Chats'
          : desktopSubPanelTab === EditorTab.Gallery
            ? 'Gallery'
            : 'Inspector';
    const subPanelContent =
      desktopSubPanelTab === EditorTab.Props &&
      selectedNode &&
      getNodeItemsComponent(selectedNode) ? (
        <div
          ref={propsItemsSplitRef}
          className="flex h-full max-h-full flex-col gap-1.5 overflow-hidden"
        >
          {renderGlassPanelSurface(
            'min-h-0 flex flex-1 flex-col',
            <div
              key={desktopSubPanelTab}
              className="tab-content-animate min-h-0 flex flex-1 flex-col"
            >
              {renderDesktopSubPanelContent()}
            </div>,
          )}
          <SplitterHandle
            axis="y"
            label="Items"
            title="Resize properties and items"
            value={clampedItemsPanelPercent}
            min={EditorItemsPanelPercent.MIN}
            max={EditorItemsPanelPercent.MAX}
            defaultValue={EditorItemsPanelPercent.DEFAULT}
            measurementRef={propsItemsSplitRef}
            valueType="percent"
            direction={-1}
            onChange={setItemsPanelPercent}
          />
          {renderGlassPanelSurface(
            'min-h-0 flex flex-col flex-shrink-0',
            <NodeItemsPanel
              node={selectedNode}
              inspectorLevel={rotoInspectorLevel}
              onInspectorLevelChange={setRotoInspectorLevel}
            />,
            { height: `${clampedItemsPanelPercent}%` },
          )}
        </div>
      ) : (
        renderGlassPanelSurface(
          'max-h-full flex flex-col self-start',
          <div
            key={desktopSubPanelTab}
            className="tab-content-animate pointer-events-auto min-h-0 flex flex-col"
          >
            {renderDesktopSubPanelContent()}
          </div>,
        )
      );

    if (layout === 'floating') {
      return (
        <div
          className="absolute inset-y-0 right-0 z-20 flex pointer-events-none p-2 pl-1"
          style={{ width: `${clampedSubPanelWidth}px` }}
        >
          <SplitterHandle
            axis="x"
            label={subPanelLabel}
            title="Resize side panel"
            value={clampedSubPanelWidth}
            min={EditorSubPanelWidth.MIN}
            max={horizontalSubPanelMaxWidth}
            defaultValue={EditorSubPanelWidth.DEFAULT}
            direction={-1}
            onChange={setSubPanelWidth}
          />
          <div className="min-w-0 flex-1 h-full min-h-0">{subPanelContent}</div>
        </div>
      );
    }

    return (
      <div
        className={`${
          layout === 'vertical'
            ? 'w-full flex-shrink-0 p-2 pt-0.5'
            : 'h-full flex-shrink-0 p-2 pl-0.5'
        }`}
        style={
          layout === 'horizontal'
            ? { width: `${clampedSubPanelWidth}px` }
            : { height: `${clampedSubPanelHeight}px` }
        }
      >
        {subPanelContent}
      </div>
    );
  };

  const renderToolsPopup = () => (
    <div
      className={`absolute inset-y-0 right-0 z-20 pointer-events-none ${toolsPopupWidthClass} p-2 pl-1`}
    >
      <div ref={toolsPopupRef} className="h-full">
        {renderGlassPanelSurface(
          'pointer-events-auto max-h-full flex flex-col',
          <div
            key="tools-popup"
            className="tab-content-animate pointer-events-auto min-h-0 flex flex-col"
          >
            <ToolsTab />
          </div>,
        )}
      </div>
    </div>
  );

  if (isMobilePortrait) {
    return (
      <aside className="glass-component relative flex w-full h-[50vh] flex-shrink-0 overflow-hidden border-t border-white/10">
        <div
          aria-hidden="true"
          className={
            uiStyle === 'solid'
              ? 'absolute inset-0 bg-gray-900'
              : 'absolute inset-0 bg-gray-900/80 backdrop-blur-xl supports-[backdrop-filter]:bg-gray-900/72'
          }
        />
        <div className="relative z-10 flex h-full w-full flex-col">
          <div className="flex items-center gap-2 p-2 border-b border-white/10 flex-shrink-0 h-10 select-none">
            <button
              onClick={closeProject}
              className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-white/5 rounded-md transition-colors"
              title="Close Project"
            >
              <Icons.ArrowLeftOnRectangle className="h-4 w-4" />
            </button>
            <div className="h-4 w-px bg-white/10 mx-1" />
            <ProjectBranchSwitcher compact />
            <SegmentedControl className="flex-1 gap-0.5 rounded-md border-0 bg-black/20">
              <SegmentedControlButton
                onClick={() => setActiveTab(EditorTab.Tools)}
                active={activeTab === EditorTab.Tools}
                className="flex-1 flex items-center justify-center text-[10px]"
                title="Add tools"
                aria-label="Add tools"
              >
                <Icons.Plus className="h-3.5 w-3.5" />
              </SegmentedControlButton>
              <SegmentedControlButton
                onClick={() => setActiveTab(EditorTab.Flow)}
                active={activeTab === EditorTab.Flow}
                className="flex-1 text-[10px]"
              >
                Flow
              </SegmentedControlButton>
              <SegmentedControlButton
                onClick={() => setActiveTab(EditorTab.Chats)}
                active={activeTab === EditorTab.Chats}
                className="flex-1 text-[10px]"
              >
                Chats
              </SegmentedControlButton>
              <SegmentedControlButton
                onClick={() => setActiveTab(EditorTab.Gallery)}
                active={activeTab === EditorTab.Gallery}
                className="flex-1 text-[10px]"
              >
                Gallery
              </SegmentedControlButton>
              <SegmentedControlButton
                onClick={() => setActiveTab(EditorTab.History)}
                active={activeTab === EditorTab.History}
                className="flex-1 text-[10px]"
              >
                History
              </SegmentedControlButton>
            </SegmentedControl>
          </div>
          <div className="flex-1 min-h-0 relative">
            <div key={activeTab} className="absolute inset-0 tab-content-animate flex flex-col">
              {renderMobileTabContent()}
            </div>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="glass-component relative flex w-full h-full overflow-hidden border-r border-white/10">
      <div
        aria-hidden="true"
        className={
          uiStyle === 'solid'
            ? 'absolute inset-0 bg-gray-900'
            : 'absolute inset-0 bg-gray-900/80 backdrop-blur-xl supports-[backdrop-filter]:bg-gray-900/72'
        }
      />
      <div className="relative z-10 flex h-full w-full flex-col">
        <div className={`${FLOW_HEADER_CLASS} h-10 flex-shrink-0 select-none`}>
          <button
            onClick={closeProject}
            className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-white/5 rounded-md transition-colors"
            title="Close Project"
          >
            <Icons.ArrowLeftOnRectangle className="h-4 w-4" />
          </button>
          <div className="h-4 w-px bg-white/10" />
          <ProjectBranchSwitcher />
          <div
            className={
              activeComfyWorkflow || isNativeGroupBreadcrumbVisible
                ? `${FLOW_BREADCRUMB_CLASS} text-xs font-semibold`
                : 'flex min-w-0 items-center gap-1 text-xs font-semibold'
            }
          >
            {activeComfyWorkflow || isNativeGroupBreadcrumbVisible ? (
              <button
                type="button"
                onClick={openRootFlowBreadcrumb}
                className={`${FLOW_BREADCRUMB_BUTTON_CLASS} tracking-wider ${
                  (
                    activeComfyWorkflow
                      ? currentComfyGraphDepth === -1 && currentNativeGroupDepth <= 0
                      : currentNativeGroupDepth <= 0
                  )
                    ? 'bg-gray-700 text-primary-100 shadow-sm hover:bg-gray-600 hover:text-white'
                    : 'text-gray-400 hover:bg-white/5 hover:text-white'
                }`}
                title="Back to root flow"
              >
                Flow
              </button>
            ) : (
              <span className="px-1 tracking-wider text-gray-400">Flow</span>
            )}
            {isNativeGroupBreadcrumbVisible ? (
              <>
                {activeNativeGroupBreadcrumbPath.map((item, index) => {
                  const isActiveNativeGroupCrumb =
                    (!activeComfyWorkflow || currentComfyGraphDepth < 0) &&
                    index + 1 === currentNativeGroupDepth;
                  return (
                    <React.Fragment key={`${item.flowId}:${item.nodeId}`}>
                      <span className="px-0.5 text-gray-600">/</span>
                      <button
                        type="button"
                        onClick={() => openNativeGroupBreadcrumbFromComposedPath(index + 1)}
                        className={`max-w-[8rem] truncate rounded px-1.5 py-1 transition-colors ${
                          isActiveNativeGroupCrumb
                            ? 'bg-gray-700 text-primary-100 shadow-sm hover:bg-gray-600 hover:text-white'
                            : index + 1 > currentNativeGroupDepth
                              ? 'text-gray-500 hover:bg-white/5 hover:text-white'
                              : 'text-gray-300 hover:bg-white/5 hover:text-white'
                        }`}
                        title={item.name}
                      >
                        {item.name}
                      </button>
                    </React.Fragment>
                  );
                })}
              </>
            ) : null}
            {activeComfyWorkflow ? (
              <>
                <span className="px-0.5 text-gray-600">/</span>
                <button
                  type="button"
                  onClick={() => setActiveComfySubgraphDepth(0)}
                  className={`max-w-[10rem] truncate rounded px-1.5 py-1 transition-colors ${
                    currentComfyGraphDepth === 0
                      ? 'bg-gray-700 text-primary-100 shadow-sm hover:bg-gray-600 hover:text-white'
                      : 'text-gray-300 hover:bg-white/5 hover:text-white'
                  }`}
                  title={activeComfyWorkflow.workflow.name}
                >
                  {activeComfyWorkflow.workflow.name}
                </button>
                {activeComfySubgraphPath.map((item, index) => (
                  <React.Fragment key={`${item.id}-${index}`}>
                    <span className="px-0.5 text-gray-600">/</span>
                    <button
                      type="button"
                      onClick={() => setActiveComfySubgraphDepth(index + 1)}
                      className={`max-w-[8rem] truncate rounded px-1.5 py-1 transition-colors ${
                        index + 1 === currentComfyGraphDepth
                          ? 'bg-gray-700 text-primary-100 shadow-sm hover:bg-gray-600 hover:text-white'
                          : index + 1 > currentComfyGraphDepth
                            ? 'text-gray-500 hover:bg-white/5 hover:text-white'
                            : 'text-gray-300 hover:bg-white/5 hover:text-white'
                      }`}
                      title={item.name}
                    >
                      {item.name}
                    </button>
                  </React.Fragment>
                ))}
              </>
            ) : null}
            {!activeComfyWorkflow && selectedComfyWorkflow ? (
              <>
                <span className="px-0.5 text-gray-600">/</span>
                <button
                  type="button"
                  onClick={openSelectedComfyGraph}
                  className={`${FLOW_BREADCRUMB_BUTTON_CLASS} text-primary-100 hover:bg-white/5 hover:text-white`}
                  title="Open Comfy workflow graph"
                  aria-label="Open Comfy workflow graph"
                >
                  <Icons.Branch className="h-3.5 w-3.5" />
                  <span className="max-w-[8rem] truncate">Open workflow</span>
                </button>
              </>
            ) : null}
            {!activeComfyWorkflow && !selectedComfyWorkflow && selectedGroupNode ? (
              <>
                <span className="px-0.5 text-gray-600">/</span>
                <button
                  type="button"
                  onClick={() => openGroupNode(selectedGroupNode.id)}
                  className={`${FLOW_BREADCRUMB_BUTTON_CLASS} text-primary-100 hover:bg-white/5 hover:text-white`}
                  title="Open group"
                  aria-label="Open group"
                >
                  <Icons.FolderOpen className="h-3.5 w-3.5" />
                  <span className="max-w-[8rem] truncate">Open group</span>
                </button>
              </>
            ) : null}
            {!activeComfyWorkflow &&
            !selectedComfyWorkflow &&
            !selectedGroupNode &&
            canGroupSelection ? (
              <>
                <span className="px-0.5 text-gray-600">/</span>
                <button
                  type="button"
                  onClick={groupSelectedNodes}
                  className={`${FLOW_BREADCRUMB_BUTTON_CLASS} border border-dashed border-gray-500/55 bg-white/[0.02] text-gray-300 hover:border-gray-400/70 hover:bg-white/5 hover:text-white`}
                  title="Create group from selected nodes"
                  aria-label="Create group from selected nodes"
                >
                  <Icons.FolderOpen className="h-3.5 w-3.5" />
                  <span className="max-w-[8rem] truncate">Create group</span>
                </button>
              </>
            ) : null}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <FlowViewModeControls
              viewMode={flowViewMode}
              flowListDirection={flowListDirection}
              onSelectViewMode={setFlowViewMode}
              onToggleFlowDirection={handleToggleFlowDirection}
              onAutoArrange={autoArrangeNodes}
            />

            <SlidingSegmentedControl
              options={DESKTOP_PANEL_TABS.map(({ tab, label, Icon }) => ({
                value: tab,
                label,
                Icon,
              }))}
              value={isDesktopSubPanelOpen ? desktopSubPanelTab : null}
              onChange={openSubPanel}
              activeWidth={DESKTOP_PANEL_ACTIVE_TAB_WIDTH}
              inactiveWidth={DESKTOP_PANEL_INACTIVE_TAB_WIDTH}
              gap={DESKTOP_PANEL_TAB_GAP}
              height={DESKTOP_HEADER_CONTROL_HEIGHT}
            />
            <SegmentedControl
              className="bb-segmented-control-compact h-7"
              style={{ height: DESKTOP_HEADER_CONTROL_HEIGHT }}
            >
              <SegmentedControlAction
                ref={addToolsButtonRef}
                onClick={toggleToolsPopup}
                className={isDesktopToolsPopupOpen ? 'bg-gray-700 text-white shadow-sm' : undefined}
                title="Add tools"
                aria-label="Add tools"
              >
                <Icons.Plus className="h-3.5 w-3.5" />
              </SegmentedControlAction>
            </SegmentedControl>
          </div>
        </div>

        <div ref={panelContentRef} className={`flex-1 min-h-0 relative ${splitLayoutClass}`}>
          <div className={`min-w-0 flex-1 ${flowContentSizeClass} ${flowContentTopClass}`}>
            <FlowTab
              showPropertiesSection={false}
              graphFitInsetRight={graphFitInsetRight}
              activeComfyGraph={activeComfyGraph}
              onActiveComfyGraphChange={setActiveComfyGraph}
            />
          </div>
          {shouldReserveSubPanelArea && isDesktopSubPanelOpen ? (
            <SplitterHandle
              axis={shouldStackSubPanelVertically ? 'y' : 'x'}
              label={
                desktopSubPanelTab === EditorTab.History
                  ? 'History'
                  : desktopSubPanelTab === EditorTab.Chats
                    ? 'Chats'
                    : desktopSubPanelTab === EditorTab.Gallery
                      ? 'Gallery'
                      : 'Inspector'
              }
              title={
                desktopSubPanelTab === EditorTab.History
                  ? 'Resize history panel'
                  : desktopSubPanelTab === EditorTab.Chats
                    ? 'Resize chat panel'
                    : desktopSubPanelTab === EditorTab.Gallery
                      ? 'Resize gallery panel'
                      : 'Resize side panel'
              }
              value={shouldStackSubPanelVertically ? clampedSubPanelHeight : clampedSubPanelWidth}
              min={
                shouldStackSubPanelVertically ? EditorSubPanelHeight.MIN : EditorSubPanelWidth.MIN
              }
              max={
                shouldStackSubPanelVertically
                  ? verticalSubPanelMaxHeight
                  : horizontalSubPanelMaxWidth
              }
              defaultValue={
                shouldStackSubPanelVertically
                  ? EditorSubPanelHeight.DEFAULT
                  : EditorSubPanelWidth.DEFAULT
              }
              direction={-1}
              onChange={shouldStackSubPanelVertically ? setSubPanelHeight : setSubPanelWidth}
            />
          ) : null}
          {isDesktopSubPanelOpen &&
            (shouldReserveSubPanelArea
              ? renderDesktopSubPanel(shouldStackSubPanelVertically ? 'vertical' : 'horizontal')
              : renderDesktopSubPanel('floating'))}
          {isDesktopToolsPopupOpen && renderToolsPopup()}
        </div>
      </div>
    </aside>
  );
}

export default Panel;
