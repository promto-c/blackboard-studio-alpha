import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { ComfyNode, ComfyWorkflow, EditorTab, NodeType } from '@blackboard/types';
import { SplitterHandle } from '@blackboard/ui';
import FlowViewModeControls from '@/components/FlowViewModeControls';
import NodeItemsPanel, { getNodeItemsComponent } from '@/components/NodeItemsPanel';
import {
  StudioSegmentedControl,
  StudioSegmentedControlButton,
} from '@/components/StudioSegmentedControl';
import { useSelectedEditorNode } from '@/hooks/useEditorNodes';
import { usePreferences } from '@/state/preferencesContext';
import {
  EDITOR_ITEMS_PANEL_PERCENT_DEFAULT,
  EDITOR_ITEMS_PANEL_PERCENT_MAX,
  EDITOR_ITEMS_PANEL_PERCENT_MIN,
  EDITOR_SUB_PANEL_HEIGHT_DEFAULT,
  EDITOR_SUB_PANEL_HEIGHT_MAX,
  EDITOR_SUB_PANEL_HEIGHT_MIN,
  EDITOR_SUB_PANEL_WIDTH_DEFAULT,
  EDITOR_SUB_PANEL_WIDTH_MAX,
  EDITOR_SUB_PANEL_WIDTH_MIN,
  clampEditorItemsPanelPercent,
  clampEditorSubPanelHeight,
  clampEditorSubPanelWidth,
} from '@/utils/editorLayout';
import { useAutoSyncRotoInspectorLevel } from '@/hooks/useAutoSyncRotoInspectorLevel';
import ToolsTab from './ToolsTab';
import HistoryTab from './HistoryTab';
import FlowTab, { type ActiveComfyGraph } from '@/features/nodes/FlowTab';
import PropertiesTab from './PropertiesTab';
import ChatsTab from './ChatsTab';
import GalleryTab from './GalleryTab';
import * as Icons from '@blackboard/icons';

interface PanelProps {
  isMobilePortrait: boolean;
}

type DesktopSubPanelTab = EditorTab.Flow | EditorTab.Gallery | EditorTab.Chats | EditorTab.History;

const MAIN_FLOW_MIN_WIDTH = 260;
const LIST_SUB_PANEL_VERTICAL_BREAKPOINT = MAIN_FLOW_MIN_WIDTH + EDITOR_SUB_PANEL_WIDTH_MIN;
const FLOW_HEADER_CLASS =
  'sticky top-0 z-20 flex items-center gap-2 border-b border-white/10 bg-gray-900/35 px-2 backdrop-blur-md supports-[backdrop-filter]:bg-gray-900/20';
const FLOW_BREADCRUMB_CLASS =
  '-ml-[3px] flex min-w-0 items-center gap-0.5 rounded-md border border-white/10 bg-black/20 p-0.5';
const FLOW_BREADCRUMB_BUTTON_CLASS =
  'inline-flex min-w-0 items-center gap-1 rounded px-1 py-1 transition-colors';

const clampValue = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const ProjectBranchSwitcher: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const projectId = useEditorSelector((state) => state.projectId);
  const projectBranches = useEditorSelector((state) => state.projectBranches);
  const activeProjectBranchId = useEditorSelector((state) => state.activeProjectBranchId);
  const { createProjectBranch, switchProjectBranch } = useEditorActions();
  const activeBranch = projectBranches.find((branch) => branch.id === activeProjectBranchId);
  const [isOpen, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [isBusy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredBranches = useMemo(() => {
    if (!normalizedQuery) return projectBranches;
    return projectBranches.filter((branch) =>
      branch.name.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [normalizedQuery, projectBranches]);
  const exactBranch = useMemo(
    () =>
      normalizedQuery
        ? projectBranches.find((branch) => branch.name.toLocaleLowerCase() === normalizedQuery)
        : null,
    [normalizedQuery, projectBranches],
  );
  const canCreateBranch = !!projectId && !!query.trim() && !exactBranch;

  const openMenu = () => {
    setQuery('');
    setOpen(true);
  };

  const closeMenu = () => {
    setOpen(false);
    setQuery('');
  };

  const handleSwitchBranch = async (branchId: string) => {
    if (!projectId || branchId === activeProjectBranchId || isBusy) {
      closeMenu();
      return;
    }

    setBusy(true);
    try {
      await switchProjectBranch(branchId);
      closeMenu();
    } catch (error) {
      console.error('Could not switch project branch:', error);
      window.alert('Could not switch branch.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateBranch = async () => {
    const branchName = query.trim();
    if (!projectId || !branchName || exactBranch || isBusy) return;

    setBusy(true);
    try {
      await createProjectBranch(branchName);
      closeMenu();
    } catch (error) {
      console.error('Could not create project branch:', error);
      window.alert('Could not create branch.');
    } finally {
      setBusy(false);
    }
  };

  const handleInputKeyDown = async (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      closeMenu();
      return;
    }

    if (event.key !== 'Enter') return;
    event.preventDefault();

    if (exactBranch) {
      await handleSwitchBranch(exactBranch.id);
      return;
    }

    if (canCreateBranch) {
      await handleCreateBranch();
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const timeoutId = window.setTimeout(() => inputRef.current?.focus(), 0);

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        closeMenu();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!projectId) return null;

  return (
    <div ref={rootRef} className="relative min-w-0 flex-shrink-0">
      <button
        type="button"
        onClick={() => (isOpen ? closeMenu() : openMenu())}
        disabled={isBusy}
        className={`inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-white/10 bg-black/20 px-2 text-xs text-gray-300 transition hover:border-white/15 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/60 disabled:cursor-wait disabled:text-gray-600 ${
          compact ? 'max-w-28' : 'max-w-40'
        }`}
        title={`Branch: ${activeBranch?.name ?? 'main'}`}
        aria-label="Project branch"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <Icons.Branch className="h-3.5 w-3.5 flex-shrink-0 text-primary-300" />
        <span className="min-w-0 truncate">{activeBranch?.name ?? 'main'}</span>
        <Icons.ChevronDown className="h-3 w-3 flex-shrink-0 text-gray-500" />
      </button>

      {isOpen ? (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-white/10 bg-gray-950/95 p-1.5 shadow-2xl backdrop-blur-xl ring-1 ring-inset ring-white/5">
          <div className="flex h-8 items-center gap-1.5 rounded-md border border-white/10 bg-black/30 px-2">
            <Icons.MagnifyingGlass className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleInputKeyDown}
              disabled={isBusy}
              placeholder="Find or create branch"
              className="min-w-0 flex-1 bg-transparent text-xs text-gray-100 outline-none placeholder:text-gray-600 disabled:cursor-wait"
              aria-label="Find or create branch"
            />
          </div>

          {canCreateBranch ? (
            <button
              type="button"
              onClick={() => void handleCreateBranch()}
              disabled={isBusy}
              className="mt-1 flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-primary-400/20 bg-primary-500/10 px-2 text-left text-xs text-primary-100 transition hover:bg-primary-500/15 disabled:cursor-wait disabled:text-gray-600"
            >
              <Icons.Branch className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="min-w-0 flex-1 truncate">Create branch "{query.trim()}"</span>
            </button>
          ) : null}

          <div className="mt-1 max-h-56 overflow-y-auto py-0.5" role="listbox">
            {filteredBranches.map((branch) => {
              const isActive = branch.id === activeProjectBranchId;
              return (
                <button
                  key={branch.id}
                  type="button"
                  onClick={() => void handleSwitchBranch(branch.id)}
                  disabled={isBusy}
                  className={`flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs transition ${
                    isActive
                      ? 'bg-primary-500/15 text-primary-100'
                      : 'text-gray-300 hover:bg-white/5 hover:text-white'
                  } disabled:cursor-wait disabled:text-gray-600`}
                  role="option"
                  aria-selected={isActive}
                >
                  <Icons.Check
                    className={`h-3.5 w-3.5 flex-shrink-0 ${isActive ? 'opacity-100' : 'opacity-0'}`}
                  />
                  <span className="min-w-0 flex-1 truncate">{branch.name}</span>
                  {branch.kind === 'agent' ? (
                    <span className="rounded bg-primary-500/10 px-1.5 py-0.5 text-[10px] uppercase text-primary-200">
                      agent
                    </span>
                  ) : null}
                </button>
              );
            })}

            {filteredBranches.length === 0 && !canCreateBranch ? (
              <div className="px-2 py-2 text-xs text-gray-500">No branches found</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};

const Panel: React.FC<PanelProps> = ({ isMobilePortrait }) => {
  const activeTab = useEditorSelector((s) => s.activeTab);
  const isSubPanelVisible = useEditorSelector((s) => s.isSubPanelVisible);
  const nodes = useEditorSelector((s) => s.nodes);
  const {
    flowListDirection,
    flowViewMode,
    setPreferences,
    uiStyle,
    editorSubPanelWidth,
    editorSubPanelHeight,
    editorItemsPanelPercent,
  } = usePreferences();
  const { setActiveTab, setSubPanelVisible, closeProject, autoArrangeNodes } = useEditorActions();
  const panelContentRef = useRef<HTMLDivElement>(null);
  const propsItemsSplitRef = useRef<HTMLDivElement>(null);
  const addToolsButtonRef = useRef<HTMLButtonElement>(null);
  const toolsPopupRef = useRef<HTMLDivElement>(null);
  const [panelContentSize, setPanelContentSize] = useState({ width: 0, height: 0 });
  const [subPanelWidth, setSubPanelWidth] = useState(() =>
    clampEditorSubPanelWidth(editorSubPanelWidth),
  );
  const [subPanelHeight, setSubPanelHeight] = useState(() =>
    clampEditorSubPanelHeight(editorSubPanelHeight),
  );
  const [itemsPanelPercent, setItemsPanelPercent] = useState(() =>
    clampEditorItemsPanelPercent(editorItemsPanelPercent),
  );
  const [rotoInspectorLevel, setRotoInspectorLevel] = useState<'node' | 'shape'>('node');
  const [activeComfyGraph, setActiveComfyGraph] = useState<ActiveComfyGraph | null>(null);
  const otherNodes = useMemo(() => nodes.filter((node) => node.type !== NodeType.SCENE), [nodes]);
  const selectedRotoLayerIds = useEditorSelector((s) => s.selectedRotoLayerIds);
  const selectedRotoPathIds = useEditorSelector((s) => s.selectedRotoPathIds);
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
  const selectedComfyWorkflow = useMemo((): {
    node: ComfyNode;
    workflow: ComfyWorkflow;
  } | null => {
    if (!selectedNode || selectedNode.type !== NodeType.COMFY) return null;
    const comfyNode = selectedNode as ComfyNode;
    const workflow =
      comfyNode.workflows.find((candidate) => candidate.id === comfyNode.selectedWorkflowId) ??
      null;
    if (!workflow?.sourceGraph) return null;
    return { node: comfyNode, workflow };
  }, [selectedNode]);
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
  const setActiveComfySubgraphPath = useCallback(
    (subgraphPath: NonNullable<ActiveComfyGraph['subgraphPath']>) => {
      if (!activeComfyGraph) return;
      setActiveComfyGraph({
        ...activeComfyGraph,
        subgraphPath,
        subgraphDepth: subgraphPath.length,
      });
    },
    [activeComfyGraph, setActiveComfyGraph],
  );
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
  const resolveDesktopSubPanelTab = useCallback((tab: EditorTab): DesktopSubPanelTab => {
    if (tab === EditorTab.History) return EditorTab.History;
    if (tab === EditorTab.Chats) return EditorTab.Chats;
    if (tab === EditorTab.Gallery) return EditorTab.Gallery;
    return EditorTab.Flow;
  }, []);
  useAutoSyncRotoInspectorLevel({
    selectedNode,
    selectedRotoLayerIds,
    selectedRotoPathIds,
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
    const nextSubPanelWidth = clampEditorSubPanelWidth(editorSubPanelWidth);
    setSubPanelWidth((current) => (current === nextSubPanelWidth ? current : nextSubPanelWidth));
  }, [editorSubPanelWidth]);

  useEffect(() => {
    const nextSubPanelHeight = clampEditorSubPanelHeight(editorSubPanelHeight);
    setSubPanelHeight((current) => (current === nextSubPanelHeight ? current : nextSubPanelHeight));
  }, [editorSubPanelHeight]);

  useEffect(() => {
    const nextItemsPanelPercent = clampEditorItemsPanelPercent(editorItemsPanelPercent);
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
      const nextSubPanelWidth = clampEditorSubPanelWidth(subPanelWidth);
      const nextSubPanelHeight = clampEditorSubPanelHeight(subPanelHeight);
      const nextItemsPanelPercent = clampEditorItemsPanelPercent(itemsPanelPercent);

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
      case EditorTab.Flow:
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

  const isSubPanelTabActive = (tab: DesktopSubPanelTab) =>
    isDesktopSubPanelOpen && desktopSubPanelTab === tab;
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
          EDITOR_SUB_PANEL_WIDTH_MIN,
          Math.min(EDITOR_SUB_PANEL_WIDTH_MAX, panelContentWidth - MAIN_FLOW_MIN_WIDTH),
        )
      : EDITOR_SUB_PANEL_WIDTH_MAX;
  const verticalSubPanelMaxHeight =
    panelContentHeight > 0
      ? Math.max(
          EDITOR_SUB_PANEL_HEIGHT_MIN,
          Math.min(EDITOR_SUB_PANEL_HEIGHT_MAX, panelContentHeight - EDITOR_SUB_PANEL_HEIGHT_MIN),
        )
      : EDITOR_SUB_PANEL_HEIGHT_MAX;
  const clampedSubPanelWidth = clampValue(
    subPanelWidth,
    EDITOR_SUB_PANEL_WIDTH_MIN,
    horizontalSubPanelMaxWidth,
  );
  const clampedSubPanelHeight = clampValue(
    subPanelHeight,
    EDITOR_SUB_PANEL_HEIGHT_MIN,
    verticalSubPanelMaxHeight,
  );
  const clampedItemsPanelPercent = clampValue(
    itemsPanelPercent,
    EDITOR_ITEMS_PANEL_PERCENT_MIN,
    EDITOR_ITEMS_PANEL_PERCENT_MAX,
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
      desktopSubPanelTab === EditorTab.Flow &&
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
            min={EDITOR_ITEMS_PANEL_PERCENT_MIN}
            max={EDITOR_ITEMS_PANEL_PERCENT_MAX}
            defaultValue={EDITOR_ITEMS_PANEL_PERCENT_DEFAULT}
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
            min={EDITOR_SUB_PANEL_WIDTH_MIN}
            max={horizontalSubPanelMaxWidth}
            defaultValue={EDITOR_SUB_PANEL_WIDTH_DEFAULT}
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
      <div ref={toolsPopupRef}>
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
            <StudioSegmentedControl className="flex-1 gap-0.5 rounded-md border-0 bg-black/20">
              <StudioSegmentedControlButton
                onClick={() => setActiveTab(EditorTab.Tools)}
                active={activeTab === EditorTab.Tools}
                className="flex-1 flex items-center justify-center text-[10px]"
                title="Add tools"
                aria-label="Add tools"
              >
                <Icons.Plus className="h-3.5 w-3.5" />
              </StudioSegmentedControlButton>
              <StudioSegmentedControlButton
                onClick={() => setActiveTab(EditorTab.Flow)}
                active={activeTab === EditorTab.Flow}
                className="flex-1 text-[10px]"
              >
                Flow
              </StudioSegmentedControlButton>
              <StudioSegmentedControlButton
                onClick={() => setActiveTab(EditorTab.Chats)}
                active={activeTab === EditorTab.Chats}
                className="flex-1 text-[10px]"
              >
                Chats
              </StudioSegmentedControlButton>
              <StudioSegmentedControlButton
                onClick={() => setActiveTab(EditorTab.Gallery)}
                active={activeTab === EditorTab.Gallery}
                className="flex-1 text-[10px]"
              >
                Gallery
              </StudioSegmentedControlButton>
              <StudioSegmentedControlButton
                onClick={() => setActiveTab(EditorTab.History)}
                active={activeTab === EditorTab.History}
                className="flex-1 text-[10px]"
              >
                History
              </StudioSegmentedControlButton>
            </StudioSegmentedControl>
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
              activeComfyWorkflow
                ? `${FLOW_BREADCRUMB_CLASS} text-xs font-semibold`
                : 'flex min-w-0 items-center gap-1 text-xs font-semibold'
            }
          >
            {activeComfyWorkflow ? (
              <button
                type="button"
                onClick={() => setActiveComfySubgraphDepth(-1)}
                className={`${FLOW_BREADCRUMB_BUTTON_CLASS} tracking-wider ${
                  currentComfyGraphDepth === -1
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
          </div>
          <div className="ml-auto flex items-center gap-1">
            {otherNodes.length > 0 && (
              <FlowViewModeControls
                viewMode={flowViewMode}
                flowListDirection={flowListDirection}
                onSelectViewMode={setFlowViewMode}
                onToggleFlowDirection={handleToggleFlowDirection}
                onAutoArrange={autoArrangeNodes}
                variant="panel"
              />
            )}

            <StudioSegmentedControl>
              <StudioSegmentedControlButton
                onClick={() => openSubPanel(EditorTab.Flow)}
                active={isSubPanelTabActive(EditorTab.Flow)}
              >
                Props
              </StudioSegmentedControlButton>
              <StudioSegmentedControlButton
                onClick={() => openSubPanel(EditorTab.Chats)}
                active={isSubPanelTabActive(EditorTab.Chats)}
              >
                Chats
              </StudioSegmentedControlButton>
              <StudioSegmentedControlButton
                onClick={() => openSubPanel(EditorTab.Gallery)}
                active={isSubPanelTabActive(EditorTab.Gallery)}
              >
                Gallery
              </StudioSegmentedControlButton>
              <StudioSegmentedControlButton
                onClick={() => openSubPanel(EditorTab.History)}
                active={isSubPanelTabActive(EditorTab.History)}
              >
                History
              </StudioSegmentedControlButton>
            </StudioSegmentedControl>
            <div className="flex items-center gap-1 bg-black/20 border border-white/10 rounded-md p-0.5">
              <button
                ref={addToolsButtonRef}
                onClick={toggleToolsPopup}
                className={`p-1 rounded transition-all flex items-center justify-center ${
                  isDesktopToolsPopupOpen
                    ? 'bg-gray-700 text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                }`}
                title="Add tools"
                aria-label="Add tools"
              >
                <Icons.Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        <div ref={panelContentRef} className={`flex-1 min-h-0 relative ${splitLayoutClass}`}>
          <div className={`min-w-0 flex-1 ${flowContentSizeClass} ${flowContentTopClass}`}>
            <FlowTab
              showPropertiesSection={false}
              showTopBar={false}
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
                shouldStackSubPanelVertically
                  ? EDITOR_SUB_PANEL_HEIGHT_MIN
                  : EDITOR_SUB_PANEL_WIDTH_MIN
              }
              max={
                shouldStackSubPanelVertically
                  ? verticalSubPanelMaxHeight
                  : horizontalSubPanelMaxWidth
              }
              defaultValue={
                shouldStackSubPanelVertically
                  ? EDITOR_SUB_PANEL_HEIGHT_DEFAULT
                  : EDITOR_SUB_PANEL_WIDTH_DEFAULT
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
};

export default Panel;
