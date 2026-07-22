import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { PixelInspector } from '@blackboard/ui';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { colors } from '@/utils/colors';
import { usePreferences } from '@/state/preferencesContext';
import { useSceneNode, useSelectedEditorNode } from '@/hooks/useEditorNodes';
import ViewportControls from './ViewportControls';
import Scene3DViewport from './Scene3DViewport';
import ViewportModeSwitch from './ViewportModeSwitch';
import ViewportCameraSelector, { type Scene3DViewportCameraMode } from './ViewportCameraSelector';
import Minimap from './Minimap';
import {
  NodeType,
  type AnyNode,
  type ComfyNode,
  type PaintNode,
  type RotoNode,
  type Scene3DNode,
  type SceneNode,
} from '@blackboard/types';
import ViewportSettingsBar from './ViewportSettingsBar';
import ViewportBackground from '@/components/ViewportBackground';
import ViewportPixelGrid, {
  getEffectiveViewportPixelZoom,
  VIEWPORT_PIXEL_GRID_FADE_ZOOM_SPAN,
  VIEWPORT_PIXEL_GRID_MAX_OPACITY,
} from '@/components/ViewportPixelGrid';
import * as THREE from 'three';
import { simplifyPath, resamplePath } from '@/utils/bspline';
import FreehandSmoothnessControl from '@/nodes/builtin/roto/FreehandSmoothnessControl';
import { ViewportOverlayRenderer, resolveOverlayVisibility } from './overlays';
import { nodeRegistry } from '@/nodes/registry';
import { useViewportInteractions } from './useViewportInteractions';
import { useViewportOverlayContext } from './useViewportOverlayContext';
import { getDataWindowProjection } from './dataWindow';
import { resolveCurrentViewerDisplayView } from '@/color-management';
import { useViewportRenderer } from '@/hooks/viewport/useViewportRenderer';
import { useViewportMediaResources } from '@/hooks/viewport/useViewportMediaResources';
import { useViewportTextTextures } from '@/hooks/viewport/useViewportTextTextures';
import { useViewportRotoMasks } from '@/hooks/viewport/useViewportRotoMasks';
import { useViewportVideoSync } from '@/hooks/viewport/useViewportVideoSync';
import { useViewportGestures } from '@/hooks/viewport/useViewportGestures';
import { useViewportRenderLoop } from '@/hooks/viewport/useViewportRenderLoop';
import { useViewportScene3DAssets } from '@/hooks/viewport/useViewportScene3DAssets';
import { useViewportScrubbing } from '@/hooks/viewport/useViewportScrubbing';
import { useViewportMotionCues } from '@/hooks/viewport/useViewportMotionCues';
import { usePreviewPerformance } from '@/hooks/viewport/usePreviewPerformance';
import { useViewportStabilization } from '@/hooks/viewport/useViewportStabilization';
import {
  useViewportPixelInspector,
  type ViewportPixelInfo,
} from '@/hooks/viewport/useViewportPixelInspector';
import {
  useHotkeyScope,
  useKeyboardState,
  useRegisterHotkeyCommands,
  useRegisterHotkeys,
  type HotkeyBinding,
  type HotkeyCommand,
} from '@/hotkeys';
import { hasRenderableNodes, nodeFlags } from '@/nodes/helpers';
import { getMediaFileKind } from '@/utils/mediaFiles';
import {
  getNodeInputRenderNodes,
  getScene3DProjectionRenderNodes,
  getViewportRenderNodes,
  resolveViewerRouting,
} from '@/utils/viewerSlots';
import { expandGroupNodesForRender } from '@/utils/groupRenderProjection';
import { useRotoItemsClipboard } from '@/nodes/builtin/roto/rotoItemsClipboard';
import { usePaintItemsClipboard } from '@/nodes/builtin/paint/paintItemsClipboard';
import {
  disposePaintGpuEngine,
  setPaintRendererInteractive,
} from '@/nodes/builtin/paint/paintGpuEngine';
import {
  createStandardClipboardHotkeyBindings,
  createStandardClipboardHotkeyCommands,
} from '@/utils/standardClipboardHotkeys';
import { ViewportSvgOverlays } from './ViewportSvgOverlays';
import { ViewportCompareOverlays } from './ViewportCompareOverlays';
import { getAllProjectNodes } from '@/state/editor/flowModel';
import { resolveRenderOutputDomain } from '@/color-management';
import { hasAdaptivePreviewNodes } from '@/utils/previewPerformance';
import { useViewportCompare } from './useViewportCompare';
import { useViewportCompareRender } from './useViewportCompareRender';
import {
  interactiveUVToViewportPixel,
  presentationFrameUVToViewportPixel,
  viewportPixelToPresentationFrameUV,
} from './compareUtils';
import { WorkingAreaOverlay } from './WorkingAreaOverlay';
import { useWorkingAreaInteraction } from './useWorkingAreaInteraction';
import { VIEWPORT_WORKING_AREA_TOOL, resolveWorkingAreaPixelRect } from './workingArea';
import { ViewportSceneOverlayFrame } from './ViewportSceneOverlayFrame';
import { useCompareViewportPresentation } from './useCompareViewportPresentation';
import { ViewportWindowLabels } from './ViewportWindowLabels';
import { getViewportImageRendering } from '@/utils/viewportInterpolation';
import { createViewportPresentation } from '@/utils/viewportPresentation';
import { getAlphaDeadRotoNodeIds, isViewerAlphaRequired } from '@/utils/alphaLiveness';

type ViewportMouseEvent = MouseEvent | React.MouseEvent<HTMLDivElement>;

const EMPTY_NODE_ID_SET: ReadonlySet<string> = new Set<string>();

const areScenePositionsEqual = (
  left: { x: number; y: number } | null,
  right: { x: number; y: number } | null,
): boolean => {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.x === right.x && left.y === right.y;
};

function Viewport() {
  // — State: subscribe to individual slices so the component only re-renders
  //   when the specific value changes (not on every store update).
  const projectId = useEditorSelector((s) => s.projectId);
  const nodes = useEditorSelector((s) => s.nodes);
  const flows = useEditorSelector((s) => s.flows);
  const zoom = useEditorSelector((s) => s.zoom);
  const pan = useEditorSelector((s) => s.pan);
  const targetZoom = useEditorSelector((s) => s.targetZoom);
  const targetPan = useEditorSelector((s) => s.targetPan);
  const viewerSettings = useEditorSelector((s) => s.viewerSettings);
  const projectColorManagement = useEditorSelector((s) => s.colorManagement);
  const projectDisplayView = projectColorManagement.viewer;
  const viewerColorManagement = useEditorSelector((s) => s.viewerColorManagement);
  const currentViewerDisplayView = useMemo(
    () => resolveCurrentViewerDisplayView(projectDisplayView, viewerColorManagement),
    [projectDisplayView, viewerColorManagement],
  );
  const viewerNodeId = useEditorSelector((s) => s.viewerNodeId);
  const compareView = useEditorSelector((s) => s.compareView);
  const viewerSlots = useEditorSelector((s) => s.viewerSlots);
  const selectedNodeId = useEditorSelector((s) => s.selectedNodeId);
  const hierarchySelections = useEditorSelector((s) => s.hierarchySelections);
  const selectedNodeIdHierSel = selectedNodeId ?? '';
  const selectedPaintLayerIds = useMemo(
    () => hierarchySelections[selectedNodeIdHierSel]?.layerIds ?? [],
    [hierarchySelections, selectedNodeIdHierSel],
  );
  const selectedPaintStrokeIds = useMemo(
    () => hierarchySelections[selectedNodeIdHierSel]?.itemIds ?? [],
    [hierarchySelections, selectedNodeIdHierSel],
  );
  const selectedRotoLayerIds = useMemo(
    () => hierarchySelections[selectedNodeIdHierSel]?.layerIds ?? [],
    [hierarchySelections, selectedNodeIdHierSel],
  );
  const selectedRotoPathIds = useMemo(
    () => hierarchySelections[selectedNodeIdHierSel]?.itemIds ?? [],
    [hierarchySelections, selectedNodeIdHierSel],
  );
  const selectedRotoPointRefs = useEditorSelector((s) => s.selectedRotoPointRefs);
  const isPlaying = useEditorSelector((s) => s.isPlaying);
  const playbackDirection = useEditorSelector((s) => s.playbackDirection);
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const timelineStartFrame = useEditorSelector((s) => s.timelineStartFrame);
  const isFrameScrubbing = useEditorSelector((s) => s.isFrameScrubbing);
  const activeViewportTool = useEditorSelector((s) => s.activeViewportTool);
  const viewportWorkingArea = useEditorSelector((s) => s.viewportWorkingArea);
  const isDrawing = useEditorSelector((s) => s.isDrawing);
  const drawingRotoPath = useEditorSelector((s) => s.drawingRotoPath);
  const rotoRefinement = useEditorSelector((s) => s.rotoRefinement);
  const maxFrames = useEditorSelector((s) => s.maxFrames);
  const fps = useEditorSelector((s) => s.fps);
  const activeTrackingPoints = useEditorSelector((s) => s.activeTrackingPoints);
  const isStabilized = useEditorSelector((s) => s.isStabilized);
  const stabilizationReference = useEditorSelector((s) => s.stabilizationReference);
  const stabilizationReferenceFrame = useEditorSelector((s) => s.stabilizationReferenceFrame);
  const stabilizationConfig = useEditorSelector((s) => s.stabilizationConfig);

  // — Actions: stable references, never cause re-renders.
  const {
    loadImage,
    setViewportTransform,
    setAnimationTarget,
    setProjectThumbnail,
    updateNode,
    setActiveViewportTool,
    setHierarchySelection,
    commitMutation,
    startDrawingShape,
    cancelDrawingShape,
    commitDrawingShape,
    addPointToDrawingShape,
    updateDrawingPoint,
    setKeyframe,
    startRotoRefinement,
    updateRotoRefinement,
    commitRotoRefinement,
    addRotoPointToPath,
    updateCacheStatus,
    signalFrameRendered,
    seekFrame,
    setFrameScrubbing,
    recaptureStabilizationReference,
    setCompareDividerPosition,
    setViewportWorkingArea,
  } = useEditorActions();
  const setSelectedRotoPointRefs = useEditorActions().setSelectedRotoPointRefs;
  const {
    primaryColor,
    rotoMotionCueEnabled,
    rotoMotionCueMode,
    rotoMotionCueScope,
    rotoMotionPathVisible,
    rotoMotionBlurPathVisible,
    rotoMotionTrailFrames,
    previewOptimizeWhileEditing,
    previewOptimizeFrameChanges,
    previewRefineDelayMs,
    previewPlaybackMode,
    previewMaxDimension,
    previewSampleLimit,
    rotoPointWeightMode,
    paintBrush,
    nudgeRadius,
    alphaOverlayColorSource,
    alphaOverlayCustomColor,
    alphaOverlayOpacity,
    alphaOverlayBgDarken,
    paintStrokePathsVisible,
    paintStrokePathsMode,
    viewportBackgroundMode,
    viewportBackgroundColor,
    viewportInterpolation,
    viewportPixelGridEnabled,
    viewportPixelGridZoomThresholdPercent,
    setPreferences,
  } = usePreferences();

  const projectSceneNode = useSceneNode();
  const selectedNode = useSelectedEditorNode();
  const activeFlow = useEditorSelector((s) => {
    const flowId = s.activeFlowId ?? s.rootFlowId;
    return flowId ? s.flows[flowId] : null;
  });
  const viewportNodes = useMemo(() => {
    return expandGroupNodesForRender(
      getViewportRenderNodes(nodes, viewerNodeId, activeFlow),
      flows,
    );
  }, [activeFlow, flows, nodes, viewerNodeId]);

  // ── Compare view nodes ───────────────────────────────────────
  const viewerRouting = useMemo(
    () => resolveViewerRouting(viewerNodeId, viewerSlots, compareView),
    [compareView, viewerNodeId, viewerSlots],
  );
  const compareSlotANodeId = viewerRouting.compare?.nodeIdA ?? null;
  const compareSlotBNodeId = viewerRouting.compare?.nodeIdB ?? null;
  const isCompareActive = viewerRouting.compare !== null;
  const viewportNodesA = useMemo(() => {
    if (!compareSlotANodeId) return viewportNodes;
    return expandGroupNodesForRender(
      getViewportRenderNodes(nodes, compareSlotANodeId, activeFlow),
      flows,
    );
  }, [activeFlow, compareSlotANodeId, flows, nodes, viewportNodes]);
  const viewportNodesB = useMemo(() => {
    if (!compareSlotBNodeId) return viewportNodes;
    return expandGroupNodesForRender(
      getViewportRenderNodes(nodes, compareSlotBNodeId, activeFlow),
      flows,
    );
  }, [activeFlow, compareSlotBNodeId, flows, nodes, viewportNodes]);
  const compareSceneNodeA = useMemo(
    () => viewportNodesA.find((node): node is SceneNode => node.type === NodeType.SCENE),
    [viewportNodesA],
  );
  const compareSceneNodeB = useMemo(
    () => viewportNodesB.find((node): node is SceneNode => node.type === NodeType.SCENE),
    [viewportNodesB],
  );
  const sceneNode = useMemo(
    () =>
      viewportNodes.find((node): node is SceneNode => node.type === NodeType.SCENE) ??
      projectSceneNode,
    [projectSceneNode, viewportNodes],
  );
  const selectedViewportNode = useMemo(
    () =>
      selectedNode
        ? (viewportNodes.find((node) => node.id === selectedNode.id) ?? selectedNode)
        : undefined,
    [selectedNode, viewportNodes],
  );
  const activeScene3DNode = useMemo(
    () =>
      selectedViewportNode?.type === NodeType.SCENE_3D
        ? (selectedViewportNode as Scene3DNode)
        : null,
    [selectedViewportNode],
  );
  const isScene3DMode = activeScene3DNode?.viewportMode === 'scene3d';
  const renderOutputDomain = useMemo(
    () =>
      isScene3DMode
        ? ({ kind: 'color' } as const)
        : resolveRenderOutputDomain({ nodes, flow: activeFlow, viewerNodeId, nodeRegistry }),
    [activeFlow, isScene3DMode, nodes, viewerNodeId],
  );
  const [scene3DViewportCameraMode, setScene3DViewportCameraMode] =
    useState<Scene3DViewportCameraMode>('sceneCamera');
  const [cachedScene3DViewportNodeId, setCachedScene3DViewportNodeId] = useState<string | null>(
    null,
  );
  const scene3DBackdropNodes = useMemo(() => {
    if (!activeScene3DNode) return null;
    return expandGroupNodesForRender(
      getNodeInputRenderNodes(nodes, activeScene3DNode.id, 'backdrop', activeFlow),
      flows,
    );
  }, [activeFlow, activeScene3DNode, flows, nodes]);
  const scene3DProjectionNodes = useMemo(() => {
    if (!activeScene3DNode) return null;
    return expandGroupNodesForRender(
      getScene3DProjectionRenderNodes(nodes, activeScene3DNode.id, activeFlow),
      flows,
    );
  }, [activeFlow, activeScene3DNode, flows, nodes]);
  const renderNodes = isScene3DMode
    ? (scene3DBackdropNodes ?? viewportNodes)
    : (scene3DProjectionNodes ?? viewportNodes);
  const activeRenderNodes = isCompareActive ? viewportNodesA : renderNodes;
  const viewportResourceNodes = useMemo(() => {
    if (!isCompareActive) return renderNodes;

    const uniqueNodes = new Map<string, AnyNode>();
    [...viewportNodesA, ...viewportNodesB].forEach((node) => {
      if (!uniqueNodes.has(node.id)) uniqueNodes.set(node.id, node);
    });
    return Array.from(uniqueNodes.values());
  }, [isCompareActive, renderNodes, viewportNodesA, viewportNodesB]);
  const cacheRetentionNodes = useMemo(() => getAllProjectNodes(flows), [flows]);
  const renderSceneNode = useMemo(
    () => renderNodes.find((node): node is SceneNode => node.type === NodeType.SCENE) ?? sceneNode,
    [renderNodes, sceneNode],
  );
  const primaryRenderSceneNode = isCompareActive
    ? (compareSceneNodeA ?? renderSceneNode)
    : renderSceneNode;
  const overlayViewNodes = isCompareActive
    ? compareView.sidesSwapped
      ? viewportNodesB
      : viewportNodesA
    : viewportNodes;
  const overlayViewSceneNode = isCompareActive
    ? compareView.sidesSwapped
      ? (compareSceneNodeB ?? primaryRenderSceneNode)
      : primaryRenderSceneNode
    : sceneNode;
  const selectedOverlayViewNode = useMemo(() => {
    if (!selectedNode) return undefined;
    const projectedNode = overlayViewNodes.find((node) => node.id === selectedNode.id);
    return projectedNode ?? (isCompareActive ? undefined : selectedNode);
  }, [isCompareActive, overlayViewNodes, selectedNode]);
  const isScene3DProjectionViewActive =
    isScene3DMode && scene3DViewportCameraMode === 'sceneCamera';
  const gestureSceneNode = isScene3DMode
    ? renderSceneNode
    : isCompareActive
      ? primaryRenderSceneNode
      : sceneNode;
  const selectedScene3DItemId = activeScene3DNode
    ? (hierarchySelections[activeScene3DNode.id]?.itemIds?.[0] ?? null)
    : null;
  const hasRenderableOutput = useMemo(
    () => hasRenderableNodes(activeRenderNodes),
    [activeRenderNodes],
  );
  const hasScene3DBackdropOutput = Boolean(scene3DBackdropNodes && hasRenderableOutput);
  const shouldMountScene3DViewport = Boolean(
    renderSceneNode &&
    activeScene3DNode &&
    (isScene3DMode || cachedScene3DViewportNodeId === activeScene3DNode.id),
  );

  useEffect(() => {
    if (!activeScene3DNode) {
      setCachedScene3DViewportNodeId(null);
      return;
    }

    if (isScene3DMode) {
      setCachedScene3DViewportNodeId(activeScene3DNode.id);
      return;
    }

    setCachedScene3DViewportNodeId((currentNodeId) =>
      currentNodeId === activeScene3DNode.id ? currentNodeId : null,
    );
  }, [activeScene3DNode, isScene3DMode]);

  const alphaOverlayStyle = useMemo(() => {
    const palette = colors[primaryColor] || colors.teal;
    const accentRgbString = palette[400] || palette[500] || colors.teal[400];
    const [r = 45, g = 212, b = 191] = accentRgbString.split(' ').map(Number);
    const accentColor: [number, number, number] = [r / 255, g / 255, b / 255];

    return {
      color: alphaOverlayColorSource === 'custom' ? alphaOverlayCustomColor : accentColor,
      opacity: alphaOverlayOpacity / 100,
      bgDarken: alphaOverlayBgDarken / 100,
    };
  }, [
    primaryColor,
    alphaOverlayColorSource,
    alphaOverlayCustomColor,
    alphaOverlayOpacity,
    alphaOverlayBgDarken,
  ]);

  const [mouseScenePos, setMouseScenePos] = useState<{ x: number; y: number } | null>(null);
  const mouseScenePosRef = useRef(mouseScenePos);
  const altPressed = useKeyboardState((snapshot) => snapshot.modifiers.alt);
  const shiftPressed = useKeyboardState((snapshot) => snapshot.modifiers.shift);
  const affineModifierPressed = useKeyboardState(
    (snapshot) => snapshot.modifiers.ctrl || snapshot.modifiers.meta,
  );

  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useHotkeyScope({ id: 'viewport', ref: viewportRef });

  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [rendererError, setRendererError] = useState<string | null>(null);
  const refreshPixelInfoAfterRenderRef = useRef<() => void>(() => {});
  const {
    interactiveRect: compareInteractiveViewportRect,
    paneLayout: comparePaneLayout,
    presetTarget: comparePresetTarget,
    leadingProjection: compareLeadingViewProjection,
    gestureTransform: compareSplitGestureTransform,
    overlayZoom,
    overlayPan,
  } = useCompareViewportPresentation({
    viewportRef,
    viewportSize,
    compareView,
    isActive: isCompareActive,
    slotASize: primaryRenderSceneNode,
    leadingSize: overlayViewSceneNode,
    zoom,
    pan,
  });

  const handleSmoothnessChange = (newEpsilon: number) => {
    updateRotoRefinement({ epsilon: newEpsilon });
  };

  const handleFrameRendered = useCallback(() => {
    signalFrameRendered();
    refreshPixelInfoAfterRenderRef.current();
  }, [signalFrameRendered]);

  useEffect(() => {
    mouseScenePosRef.current = mouseScenePos;
  }, [mouseScenePos]);

  const threeStuff = useRef({
    scene: new THREE.Scene(),
    camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10),
    plane: new THREE.PlaneGeometry(2, 2),
    materials: new Map<string, THREE.ShaderMaterial>(),
    renderTargets: [] as THREE.WebGLRenderTarget[],
    utilityTargets: new Map<string, THREE.WebGLRenderTarget>(),
    ocioTextures: new Map<string, THREE.Texture>(),
    quad: null as THREE.Mesh | null,
  }).current;

  useEffect(() => {
    if (!threeStuff.quad) {
      threeStuff.quad = new THREE.Mesh(threeStuff.plane);
      threeStuff.scene.add(threeStuff.quad);
    }

    return () => {
      // Cleanup on unmount handled by handleRendererDispose mainly
    };
  }, [threeStuff]);

  const {
    textureCacheRef,
    mediaUpdateTrigger,
    bumpMediaUpdateTrigger,
    visualFrame,
    isRenderReady,
    isLoading,
  } = useViewportMediaResources({
    activeNodes: viewportResourceNodes,
    retentionNodes: cacheRetentionNodes,
    sceneNode: primaryRenderSceneNode,
    workingArea: isCompareActive || isScene3DMode ? undefined : viewportWorkingArea,
    currentFrame,
    selectedNode,
    timelineStartFrame,
    maxFrames,
    updateCacheStatus,
    fps,
  });
  const dataWindowProjection = useMemo(
    () =>
      overlayViewSceneNode
        ? getDataWindowProjection(overlayViewSceneNode, overlayViewNodes, visualFrame)
        : null,
    [overlayViewNodes, overlayViewSceneNode, visualFrame],
  );
  const dataWindowNode = selectedOverlayViewNode;
  const inputDataWindowRect = dataWindowNode
    ? (dataWindowProjection?.inputs.get(dataWindowNode.id) ?? null)
    : null;
  const dataWindowIsHandled = dataWindowNode
    ? (dataWindowProjection?.handledDataWindowNodeIds.has(dataWindowNode.id) ?? false)
    : false;
  const dataWindowRect = dataWindowNode
    ? dataWindowIsHandled
      ? (dataWindowProjection?.outputs.get(dataWindowNode.id) ?? null)
      : inputDataWindowRect
    : null;
  const transformInputDataWindowRect =
    dataWindowNode && nodeFlags(dataWindowNode.type).showInputDataWindow
      ? inputDataWindowRect
      : null;

  const textTexturesRef = useViewportTextTextures({
    nodes: viewportResourceNodes,
    currentFrame: visualFrame,
    bumpMediaUpdate: bumpMediaUpdateTrigger,
  });

  // --- Video sync ---
  useViewportVideoSync({
    nodes: viewportResourceNodes,
    currentFrame,
    isPlaying,
    playbackDirection,
    fps,
    textureCacheRef,
  });

  // --- Scrubbing ---
  const { isScrubbing, startScrub } = useViewportScrubbing({
    currentFrame,
    seekFrame,
    setFrameScrubbing,
  });

  // Capture-phase pointerdown: only stopPropagation to block OrbitControls in
  // 3D perspective mode. Never call startScrub here or preventDefault, because
  // preventDefault() on pointerdown can suppress compatibility mouse events
  // (mousemove/mouseup) that the scrub session depends on.
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 1 || !e.ctrlKey) return;
      if (!isScene3DMode) return;
      if (isScene3DProjectionViewActive) return;
      if (!gestureSceneNode) return;

      // Only stop propagation — no preventDefault to avoid suppressing
      // compatibility mouse events. preventDefault is handled on mousedown
      // in handleViewportPanMouseDown via handleMouseDown.
      e.stopPropagation();
    };

    element.addEventListener('pointerdown', handlePointerDown, { capture: true });
    return () => element.removeEventListener('pointerdown', handlePointerDown, { capture: true });
  }, [isScene3DMode, isScene3DProjectionViewActive, gestureSceneNode]);

  const {
    stabilizationMatrix,
    stabilizationScale,
    stabilizationInverseMatrix,
    stabilizationTransformStyle,
    viewportToSceneCentered,
  } = useViewportStabilization({
    isStabilized,
    stabilizationReference,
    stabilizationReferenceFrame,
    stabilizationConfig,
    selectedNode: selectedOverlayViewNode,
    hierarchySelections,
    selectedNodeId,
    sceneNode: overlayViewSceneNode,
    visualFrame,
    pan: overlayPan,
    zoom: overlayZoom,
    viewportRef,
    recaptureStabilizationReference,
  });

  const viewportPresentation = useMemo(
    () =>
      isCompareActive
        ? undefined
        : createViewportPresentation(stabilizationInverseMatrix, viewportInterpolation, {
            size: viewportSize,
            zoom,
            pan,
            pixelGrid: {
              opacity:
                viewportPixelGridEnabled && hasRenderableOutput
                  ? VIEWPORT_PIXEL_GRID_MAX_OPACITY
                  : 0,
              thresholdZoom: viewportPixelGridZoomThresholdPercent / 100,
              fadeZoomSpan: VIEWPORT_PIXEL_GRID_FADE_ZOOM_SPAN,
            },
          }),
    [
      hasRenderableOutput,
      isCompareActive,
      pan,
      stabilizationInverseMatrix,
      viewportInterpolation,
      viewportPixelGridEnabled,
      viewportPixelGridZoomThresholdPercent,
      viewportSize,
      zoom,
    ],
  );

  const workingAreaInteraction = useWorkingAreaInteraction({
    active: activeViewportTool === VIEWPORT_WORKING_AREA_TOOL && !isCompareActive && !isScene3DMode,
    scene: sceneNode,
    zoom,
    workingArea: viewportWorkingArea,
    onCommit: setViewportWorkingArea,
  });
  const activeWorkingAreaPixelRect = useMemo(
    () =>
      isCompareActive || isScene3DMode
        ? null
        : resolveWorkingAreaPixelRect(viewportWorkingArea, renderSceneNode),
    [isCompareActive, isScene3DMode, renderSceneNode, viewportWorkingArea],
  );

  const [pixelInfo, setPixelInfo] = useState<ViewportPixelInfo | null>(null);

  // --- Unified interaction hooks ---
  const { interaction, ctxRef } = useViewportInteractions({
    selectedNode: selectedOverlayViewNode,
    selectedNodeId,
    nodes,
    sceneNode: overlayViewSceneNode,
    projectColorManagement,
    selectedRotoLayerIds,
    selectedRotoPathIds,
    selectedRotoPointRefs,
    selectedPaintLayerIds,
    selectedPaintStrokeIds,
    zoom: overlayZoom,
    visualFrame,
    activeViewportTool,
    altPressed,
    shiftPressed,
    affineModifierPressed,
    mouseScenePos,
    isDrawing,
    drawingRotoPath,
    rotoRefinement,
    nudgeRadius,
    rotoPointWeightMode,
    paintBrush,
    viewerChannels: viewerSettings.channels,
    pixelInfo,
    transformInputDataWindowRect,
    viewportRef,
    viewportToSceneCentered,
    updateNode,
    commitMutation,
    setActiveViewportTool,
    setHierarchySelection,
    setSelectedRotoPointRefs,
    setKeyframe,
    startDrawingShape,
    addPointToDrawingShape,
    updateDrawingPoint,
    commitDrawingShape,
    cancelDrawingShape,
    addRotoPointToPath,
    startRotoRefinement,
    commitRotoRefinement,
    setPreferences,
  });

  const paintLivePreview = ctxRef.current.hooks.paint.livePreview;
  useEffect(() => {
    bumpMediaUpdateTrigger();
  }, [bumpMediaUpdateTrigger, paintLivePreview]);

  const isInteractivePreviewActive = interaction.isPreviewActive?.() ?? false;
  const isInteractiveRotoPreviewActive =
    isInteractivePreviewActive && selectedNode?.type === NodeType.ROTO;
  const viewerRequiresAlpha = isViewerAlphaRequired(viewerSettings, renderOutputDomain);
  const alphaDeadRotoCacheRef = useRef<{
    viewerRequiresAlpha: boolean;
    compareActive: boolean;
    resourceNodeIds: ReadonlySet<string>;
    primaryNodeIds: ReadonlySet<string>;
    compareBNodeIds: ReadonlySet<string>;
  } | null>(null);
  const alphaDeadRotoNodeIds = useMemo(() => {
    const cached = alphaDeadRotoCacheRef.current;
    // Roto geometry replaces the node object on every pointer update, but it
    // cannot change graph alpha routing. Latch the result for the interaction
    // instead of rebuilding downstream adjacency on every mouse event.
    if (
      isInteractiveRotoPreviewActive &&
      cached?.viewerRequiresAlpha === viewerRequiresAlpha &&
      cached.compareActive === isCompareActive
    ) {
      return cached;
    }

    const resourceNodeIds = getAlphaDeadRotoNodeIds({
      nodes: viewportResourceNodes,
      viewerRequiresAlpha,
      nodeRegistry,
    });
    const primaryNodes = isCompareActive ? viewportNodesA : renderNodes;
    const primaryNodeIds =
      primaryNodes === viewportResourceNodes
        ? resourceNodeIds
        : getAlphaDeadRotoNodeIds({
            nodes: primaryNodes,
            viewerRequiresAlpha,
            nodeRegistry,
          });
    const compareBNodeIds = isCompareActive
      ? getAlphaDeadRotoNodeIds({
          nodes: viewportNodesB,
          viewerRequiresAlpha,
          nodeRegistry,
        })
      : EMPTY_NODE_ID_SET;
    const result = {
      viewerRequiresAlpha,
      compareActive: isCompareActive,
      resourceNodeIds,
      primaryNodeIds,
      compareBNodeIds,
    };
    alphaDeadRotoCacheRef.current = result;
    return result;
  }, [
    isCompareActive,
    isInteractiveRotoPreviewActive,
    renderNodes,
    viewerRequiresAlpha,
    viewportNodesA,
    viewportNodesB,
    viewportResourceNodes,
  ]);
  const editedRotoAlphaIsLive =
    selectedNode?.type !== NodeType.ROTO ||
    !alphaDeadRotoNodeIds.resourceNodeIds.has(selectedNode.id);
  const freezeRotoMaskWhileEditing = isInteractiveRotoPreviewActive && !editedRotoAlphaIsLive;
  const renderRelevantResourceNodes = useMemo(
    () =>
      viewportResourceNodes.filter((node) => !alphaDeadRotoNodeIds.resourceNodeIds.has(node.id)),
    [alphaDeadRotoNodeIds.resourceNodeIds, viewportResourceNodes],
  );
  const hasAdaptivePreviewWork = useMemo(
    () => hasAdaptivePreviewNodes(renderRelevantResourceNodes, nodeRegistry),
    [renderRelevantResourceNodes],
  );

  const {
    previewOptimized,
    quality: renderQuality,
    reportPrepareDuration,
    reportRenderDuration,
  } = usePreviewPerformance({
    renderRevision: renderRelevantResourceNodes,
    currentFrame,
    fps,
    isPlaying,
    isFrameScrubbing,
    // Keep the adaptive-preview lifecycle active even while the completed
    // image is frozen. On release this produces a cheap proxy result first,
    // followed by the normal delayed full-resolution refinement.
    editingPreviewActive: isInteractivePreviewActive,
    hasAdaptivePreviewWork,
    optimizeWhileEditing: previewOptimizeWhileEditing,
    optimizeFrameChanges: previewOptimizeFrameChanges,
    refineDelayMs: previewRefineDelayMs,
    playbackMode: previewPlaybackMode,
    sceneSize: renderSceneNode ?? { width: 1, height: 1 },
    viewportSize,
    maxDimension: previewMaxDimension,
    sampleLimit: previewSampleLimit,
  });

  const rotoMaskTexturesRef = useViewportRotoMasks({
    nodes: viewportResourceNodes,
    sceneNode: renderSceneNode,
    viewportSize,
    currentFrame: visualFrame,
    optimizedPreviewActive: previewOptimized,
    editingPreviewActive: isInteractiveRotoPreviewActive,
    editingNodeId: isInteractiveRotoPreviewActive ? (selectedNodeId ?? null) : null,
    maxDimension: previewMaxDimension,
    sampleLimit: previewSampleLimit,
    reportPrepareDuration,
    rotoPointWeightMode,
    bypassNodeIds: alphaDeadRotoNodeIds.resourceNodeIds,
    suspendMaskUpdatesWhileEditing: freezeRotoMaskWhileEditing,
    bumpMediaUpdate: bumpMediaUpdateTrigger,
  });

  const handleRendererDispose = useCallback(() => {
    threeStuff.materials.forEach((mat) => mat?.dispose());
    threeStuff.renderTargets.forEach((rt) => rt?.dispose());
    threeStuff.utilityTargets.forEach((rt) => rt?.dispose());
    threeStuff.ocioTextures.forEach((texture) => texture.dispose());
    threeStuff.utilityTargets.clear();
    threeStuff.ocioTextures.clear();
    textureCacheRef.current.clear();
    textTexturesRef.current.forEach((entry) => entry?.texture?.dispose());
    rotoMaskTexturesRef.current.forEach((entry) => {
      if (entry?.dispose) {
        entry.dispose();
      }
    });

    if (threeStuff.quad) {
      threeStuff.scene.remove(threeStuff.quad);
      threeStuff.quad.geometry.dispose();
      threeStuff.quad = null;
    }
  }, [rotoMaskTexturesRef, textTexturesRef, textureCacheRef, threeStuff]);

  const handleRendererError = useCallback((message: string | null) => {
    setRendererError(message);
  }, []);

  const rendererViewportSize = useMemo(
    () =>
      isScene3DMode && renderSceneNode
        ? { width: renderSceneNode.width, height: renderSceneNode.height }
        : viewportSize,
    [isScene3DMode, renderSceneNode, viewportSize],
  );

  const gl = useViewportRenderer(
    canvasRef,
    rendererViewportSize,
    handleRendererDispose,
    handleRendererError,
  );

  useEffect(() => {
    if (!gl) return;
    setPaintRendererInteractive(gl, true);
    return () => {
      setPaintRendererInteractive(gl, false);
      disposePaintGpuEngine(gl);
    };
  }, [gl]);

  useViewportScene3DAssets({
    renderer: gl,
    nodes: viewportResourceNodes,
    sceneNode: renderSceneNode,
    projectColorManagement,
    onAssetsReady: bumpMediaUpdateTrigger,
  });

  // ── Compare View hook ────────────────────────────────────────
  useViewportCompare();

  // ── Normal render loop ──────────────────────────────────────
  const { finalCompBufferRef, displayOutputBufferRef } = useViewportRenderLoop({
    gl,
    canvasRef,
    rendererSurfaceSize: rendererViewportSize,
    nodes: isCompareActive ? viewportNodesA : renderNodes,
    sceneNode: primaryRenderSceneNode,
    visualFrame,
    viewerSettings,
    displayView: currentViewerDisplayView,
    projectColorManagement,
    outputDomain: renderOutputDomain,
    renderQuality,
    alphaOverlayStyle,
    hasRenderableNodes: hasRenderableOutput,
    isRenderReady,
    captureDisplayOutput: isCompareActive,
    presentation: viewportPresentation,
    mediaUpdateTrigger,
    threeStuff,
    textureCacheRef,
    textTexturesRef,
    rotoMaskTexturesRef,
    bypassNodeIds: alphaDeadRotoNodeIds.primaryNodeIds,
    freezeImageWhileEditing: freezeRotoMaskWhileEditing,
    deferProjectThumbnailCapture:
      isScene3DMode ||
      isPlaying ||
      isFrameScrubbing ||
      isInteractivePreviewActive ||
      isCompareActive,
    signalFrameRendered: handleFrameRendered,
    reportRenderDuration,
    setProjectThumbnail,
    workingArea: activeWorkingAreaPixelRect,
  });

  // ── Compare Render (renders when compare mode is active) ────
  const { finalCompBufferRef: compareCompBufferRef } = useViewportCompareRender({
    gl,
    viewportSize: rendererViewportSize,
    interactiveViewportRect: compareInteractiveViewportRect,
    compareView,
    paneLayout: comparePaneLayout,
    viewportInterpolation,
    viewportNodesA,
    viewportNodesB,
    sceneNodeA: primaryRenderSceneNode,
    sceneNodeB: compareSceneNodeB ?? renderSceneNode,
    visualFrame,
    viewerSettings,
    displayView: currentViewerDisplayView,
    projectColorManagement,
    outputDomain: renderOutputDomain,
    renderQuality,
    alphaOverlayStyle,
    hasRenderableNodes: hasRenderableOutput,
    isRenderReady,
    bypassNodeIdsB: alphaDeadRotoNodeIds.compareBNodeIds,
    freezeImageWhileEditing: freezeRotoMaskWhileEditing,
    mediaUpdateTrigger,
    slotADisplayOutputRef: displayOutputBufferRef,
    textureCacheRef,
    textTexturesRef,
    rotoMaskTexturesRef,
    zoom,
    pan,
  });

  // When compare mode is active, use compare comp buffer instead
  const activeCompBuffer = isCompareActive ? compareCompBufferRef : finalCompBufferRef;

  const {
    clearPixelInfo,
    setMouseScenePosRef,
    updatePixelInfoAtScenePos,
    refreshPixelInfoAfterRender,
  } = useViewportPixelInspector({
    gl,
    finalCompBufferRef: activeCompBuffer,
    sceneNode: overlayViewSceneNode,
    hasRenderableOutput,
    isLoading,
    isPlaying,
    mouseScenePos,
    viewerNodeId,
    pixelInfo,
    setPixelInfo,
  });

  refreshPixelInfoAfterRenderRef.current = refreshPixelInfoAfterRender;

  const minimapPreviewRefreshToken = useMemo(
    () => ({
      alphaOverlayStyle,
      hasRenderableOutput,
      mediaUpdateTrigger,
      nodes: renderNodes,
      viewerSettings,
      visualFrame,
      viewportInterpolation,
    }),
    [
      alphaOverlayStyle,
      hasRenderableOutput,
      mediaUpdateTrigger,
      renderNodes,
      viewerSettings,
      visualFrame,
      viewportInterpolation,
    ],
  );

  const showInteractionOverlays = interaction.shouldForceOverlays();
  const showOverlays =
    (isCompareActive ? false : viewerSettings.showOverlays) || showInteractionOverlays;

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const observer = new ResizeObserver(() => {
      if (element) {
        setViewportSize({ width: element.clientWidth, height: element.clientHeight });
      }
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files?.[0]) {
      const file = e.dataTransfer.files[0];
      if (getMediaFileKind(file) !== 'unknown') loadImage(file);
    }
  };

  // --- Gesture / zoom / pan ---
  const { panelWidth, isFit, fitToView, startPan, isMousePanning } = useViewportGestures({
    sceneNode: gestureSceneNode,
    enableGestures: !isScene3DMode || isScene3DProjectionViewActive,
    zoom,
    pan,
    targetZoom,
    targetPan,
    viewportSize,
    viewportRef,
    projectId,
    setViewportTransform,
    setAnimationTarget,
    gestureTransform: compareSplitGestureTransform,
    fitTargetOverride: comparePresetTarget,
  });
  const previousComparePresentationRef = useRef({
    isActive: isCompareActive,
    sizingRequestId: compareView.sizingRequestId,
  });
  useEffect(() => {
    const previous = previousComparePresentationRef.current;
    previousComparePresentationRef.current = {
      isActive: isCompareActive,
      sizingRequestId: compareView.sizingRequestId,
    };

    if (
      isCompareActive &&
      (!previous.isActive || previous.sizingRequestId !== compareView.sizingRequestId)
    ) {
      fitToView();
    }
  }, [compareView.sizingRequestId, fitToView, isCompareActive]);

  const toggleScene3DViewportMode = useCallback(() => {
    if (!activeScene3DNode) return false;
    const nextMode = activeScene3DNode.viewportMode === 'scene3d' ? 'canvas2d' : 'scene3d';
    updateNode(activeScene3DNode.id, { viewportMode: nextMode }, false);
    return true;
  }, [activeScene3DNode, updateNode]);

  const activeViewportToolRef = useRef(activeViewportTool);
  useEffect(() => {
    const previousTool = activeViewportToolRef.current;
    if (previousTool === activeViewportTool) return;

    activeViewportToolRef.current = activeViewportTool;
    interaction.cleanupOnToolChange(previousTool);
  }, [activeViewportTool, interaction]);

  const runtimeCommands = useMemo<HotkeyCommand[]>(
    () => [
      {
        id: 'viewport.fitToView.runtime',
        run: () => {
          fitToView();
          return true;
        },
      },
      {
        id: 'viewport.toggleScene3DViewportMode.runtime',
        title: 'Toggle 2D/3D View',
        run: () => toggleScene3DViewportMode(),
      },
      {
        id: 'viewport.commitRotoRefinement.runtime',
        run: () => interaction.handleCommand('commitRotoRefinement'),
      },
      {
        id: 'viewport.deleteNudgeSelection.runtime',
        run: () => interaction.handleCommand('deleteNudgeSelection'),
      },
      {
        id: 'viewport.deleteComfyRegion.runtime',
        run: (context) => {
          if (context.isTextEntry) return false;
          return interaction.handleCommand('deleteComfyRegion');
        },
      },
    ],
    [fitToView, interaction, toggleScene3DViewportMode],
  );

  const runtimeBindings = useMemo<HotkeyBinding[]>(
    () => [
      {
        keys: 'F',
        command: 'viewport.fitToView.runtime',
        scope: 'viewport',
        weight: 400,
        repeat: false,
      },
      {
        keys: 'V',
        command: 'viewport.toggleScene3DViewportMode.runtime',
        scope: 'viewport',
        weight: 400,
        repeat: false,
        when: () => Boolean(activeScene3DNode),
      },
      {
        keys: 'Escape',
        command: 'viewport.commitRotoRefinement.runtime',
        scope: 'viewport',
        weight: 400,
        when: () => Boolean(rotoRefinement),
      },
      {
        keys: ['Delete', 'Backspace'],
        command: 'viewport.deleteNudgeSelection.runtime',
        scope: 'viewport',
        weight: 400,
      },
      {
        keys: ['Delete', 'Backspace'],
        command: 'viewport.deleteComfyRegion.runtime',
        scope: 'viewport',
        weight: 500,
        preventDefault: true,
        when: (context) =>
          context.selectedNodeType === NodeType.COMFY &&
          Boolean((context.selectedNode as ComfyNode | null)?.viewportPromptRegions?.length),
      },
    ],
    [activeScene3DNode, rotoRefinement],
  );

  const rotoClipboard = useRotoItemsClipboard({
    node: selectedNode?.type === NodeType.ROTO ? (selectedNode as RotoNode) : null,
    selectedLayerIds: selectedRotoLayerIds,
    selectedPathIds: selectedRotoPathIds,
    selectedPointRefs: selectedRotoPointRefs,
    updateNode,
    onSetHierarchySelection: (layerIds, itemIds) =>
      setHierarchySelection(selectedNodeId ?? '', layerIds, itemIds),
  });
  const paintClipboard = usePaintItemsClipboard({
    node: selectedNode?.type === NodeType.PAINT ? (selectedNode as PaintNode) : null,
    selectedLayerIds: selectedPaintLayerIds,
    selectedStrokeIds: selectedPaintStrokeIds,
    updateNode,
    onSetHierarchySelection: (layerIds, itemIds) =>
      setHierarchySelection(selectedNodeId ?? '', layerIds, itemIds),
  });
  const viewportClipboardHotkeys = useMemo(() => {
    if (!selectedNode) {
      return { onCopy: () => false, onCut: () => false, onPaste: () => false };
    }
    const def = nodeRegistry.get(selectedNode.type);
    const ctx = { rotoClipboard, paintClipboard };
    return (
      def?.getClipboardHandlers?.(selectedNode, ctx) ?? {
        onCopy: () => false,
        onCut: () => false,
        onPaste: () => false,
      }
    );
  }, [selectedNode, rotoClipboard, paintClipboard]);
  const runtimeClipboardCommands = useMemo(
    () => createStandardClipboardHotkeyCommands('viewport.runtime', viewportClipboardHotkeys),
    [viewportClipboardHotkeys],
  );
  const runtimeClipboardBindings = useMemo(
    () =>
      createStandardClipboardHotkeyBindings({
        idPrefix: 'viewport.runtime',
        scope: 'viewport',
        weight: 400,
      }),
    [],
  );

  useRegisterHotkeyCommands('viewport.runtime', [...runtimeCommands, ...runtimeClipboardCommands]);
  useRegisterHotkeys('viewport.runtime', [...runtimeBindings, ...runtimeClipboardBindings]);

  const smoothnessControlRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!rotoRefinement) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (smoothnessControlRef.current && !smoothnessControlRef.current.contains(e.target as Node))
        commitRotoRefinement();
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [rotoRefinement, commitRotoRefinement]);

  const handleViewportPanMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 1 || !gestureSceneNode) return false;
    e.preventDefault();

    if (e.ctrlKey) {
      startScrub(e.clientX);
      return true;
    }

    return startPan(e);
  };

  /**
   * Update the wipe divider position from a mouse event.
   *
   * - viewport / cursor mode: stores viewport UV directly
   * - canvas mode: converts viewport UV → canvas UV so the divider
   *   stays at the cursor position on the canvas content
   */
  const updateWipeDividerFromMouse = useCallback(
    (clientX: number, clientY: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const ref = compareView.wipe.reference;
      if (ref === 'canvas' && compareLeadingViewProjection) {
        const viewportPixel =
          compareView.wipe.orientation === 'vertical' ? clientX - rect.left : clientY - rect.top;
        const canvasUV = viewportPixelToPresentationFrameUV(
          viewportPixel,
          compareView.wipe.orientation,
          compareLeadingViewProjection.frame,
        );
        setCompareDividerPosition(Math.max(0, Math.min(1, canvasUV)));
      } else {
        const viewportPoint = { x: clientX - rect.left, y: clientY - rect.top };
        const interactiveUV =
          compareView.wipe.orientation === 'vertical'
            ? (viewportPoint.x - compareInteractiveViewportRect.x) /
              compareInteractiveViewportRect.width
            : (viewportPoint.y - compareInteractiveViewportRect.y) /
              compareInteractiveViewportRect.height;
        const clamped = Math.max(0, Math.min(1, interactiveUV));
        setCompareDividerPosition(clamped);
      }
    },
    [
      compareInteractiveViewportRect,
      compareLeadingViewProjection,
      compareView.wipe.orientation,
      compareView.wipe.reference,
      setCompareDividerPosition,
    ],
  );

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isScene3DMode) {
      if (isScene3DProjectionViewActive) {
        handleViewportPanMouseDown(e);
      } else if (e.button === 1 && e.ctrlKey) {
        // Perspective mode: Ctrl+MMB → scrub (same as 2D view).
        // preventDefault on mousedown prevents auto-scroll without
        // suppressing pointer compatibility events.
        handleViewportPanMouseDown(e);
      }
      return;
    }
    if (isLoading) return;
    if (rotoRefinement) return;

    // ── Compare mode: wipe divider dragging ────────────────────
    if (isCompareActive && compareView.mode === 'wipe' && e.button === 0) {
      isWipeDraggingRef.current = true;
      e.preventDefault();
      updateWipeDividerFromMouse(e.clientX, e.clientY);
      return;
    }

    const mousePos = getViewportMousePos(e.clientX, e.clientY);
    if (!mousePos) return;
    const scenePos = viewportToSceneCentered(mousePos);

    if (workingAreaInteraction.handleMouseDown(scenePos, e.button)) {
      e.preventDefault();
      return;
    }

    // Delegate to unified interaction (returns true if consumed)
    if (
      interaction.handleMouseDown({
        clientPoint: { x: e.clientX, y: e.clientY },
        scenePoint: { x: scenePos.x, y: scenePos.y },
        button: e.button,
        modifiers: { alt: e.altKey, shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey },
        nativeEvent: e.nativeEvent,
      })
    )
      return;

    // Middle Mouse Button Logic (common viewport behaviour)
    if (handleViewportPanMouseDown(e)) return;
  };

  const [isDragging, setIsDragging] = useState(false);
  const lastHandledMouseEventRef = useRef<MouseEvent | null>(null);
  const isWipeDraggingRef = useRef(false);

  const getViewportMousePos = useCallback((clientX: number, clientY: number) => {
    const viewportElement = viewportRef.current;
    if (!viewportElement) return null;
    const rect = viewportElement.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const getNativeMouseEvent = useCallback((event: ViewportMouseEvent) => {
    return 'nativeEvent' in event ? event.nativeEvent : event;
  }, []);

  const handleMouseMove = useCallback(
    (e: ViewportMouseEvent) => {
      const nativeEvent = getNativeMouseEvent(e);
      if (lastHandledMouseEventRef.current === nativeEvent) return;
      lastHandledMouseEventRef.current = nativeEvent;

      // ── Compare mode: wipe divider dragging & cursor-follow ──
      if (isCompareActive && compareView.mode === 'wipe' && !isScene3DMode) {
        if (isWipeDraggingRef.current) {
          e.preventDefault();
          updateWipeDividerFromMouse(e.clientX, e.clientY);
          return;
        }
        // Cursor-follow mode: always keep divider at cursor
        if (compareView.wipe.reference === 'cursor') {
          updateWipeDividerFromMouse(e.clientX, e.clientY);
          return;
        }
      }

      if (isScene3DMode) return;
      if (isScrubbing) return;
      if (isMousePanning) return;

      const mousePos = getViewportMousePos(e.clientX, e.clientY);
      if (!mousePos) return;
      const scenePos = viewportToSceneCentered(mousePos);
      if (!areScenePositionsEqual(mouseScenePosRef.current, scenePos)) {
        mouseScenePosRef.current = scenePos;
        setMouseScenePosRef(scenePos);
        setMouseScenePos(scenePos);
      }

      if (isLoading) return;

      if (
        workingAreaInteraction.handleMouseMove(scenePos, {
          alt: e.altKey,
          shift: e.shiftKey,
        })
      ) {
        e.preventDefault();
        return;
      }

      // Delegate to unified interaction (returns true if consumed)
      if (
        interaction.handleMouseMove({
          clientPoint: { x: e.clientX, y: e.clientY },
          scenePoint: { x: scenePos.x, y: scenePos.y },
          button: e.button,
          modifiers: { alt: e.altKey, shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey },
          nativeEvent,
        })
      )
        return;

      updatePixelInfoAtScenePos(scenePos);
    },
    [
      getNativeMouseEvent,
      getViewportMousePos,
      isScene3DMode,
      isLoading,
      isMousePanning,
      isScrubbing,
      interaction,
      updatePixelInfoAtScenePos,
      viewportToSceneCentered,
      setMouseScenePosRef,
      isCompareActive,
      compareView.mode,
      compareView.wipe.reference,
      updateWipeDividerFromMouse,
      workingAreaInteraction,
    ],
  );

  const handleMouseUp = useCallback(
    (e: ViewportMouseEvent) => {
      const nativeEvent = getNativeMouseEvent(e);
      if (lastHandledMouseEventRef.current === nativeEvent) return;
      lastHandledMouseEventRef.current = nativeEvent;

      // ── Compare mode: stop wipe divider dragging ────────────
      if (isWipeDraggingRef.current) {
        isWipeDraggingRef.current = false;
        return;
      }

      if (isScene3DMode) return;
      if (isLoading) return;
      if (workingAreaInteraction.handleMouseUp()) return;
      const mousePos = getViewportMousePos(e.clientX, e.clientY);
      if (!mousePos) return;
      const scenePos = viewportToSceneCentered(mousePos);
      interaction.handleMouseUp({
        clientPoint: { x: e.clientX, y: e.clientY },
        scenePoint: { x: scenePos.x, y: scenePos.y },
        button: e.button,
        modifiers: { alt: e.altKey, shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey },
        nativeEvent,
      });
    },
    [
      getNativeMouseEvent,
      getViewportMousePos,
      interaction,
      isLoading,
      isScene3DMode,
      viewportToSceneCentered,
      workingAreaInteraction,
    ],
  );

  useEffect(() => {
    if (!interaction.hasGlobalMouseCapture() && !workingAreaInteraction.isDragging) return;

    const handleWindowMouseMove = (event: MouseEvent) => {
      handleMouseMove(event);
    };
    const handleWindowMouseUp = (event: MouseEvent) => {
      handleMouseUp(event);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [handleMouseMove, handleMouseUp, interaction, workingAreaInteraction.isDragging]);

  useEffect(() => {
    if (!isScrubbing) return;
    clearPixelInfo();
    mouseScenePosRef.current = null;
    setMouseScenePosRef(null);
    setMouseScenePos(null);
  }, [clearPixelInfo, isScrubbing, setMouseScenePosRef]);

  useEffect(() => {
    if (!isMousePanning) return;
    clearPixelInfo();
    mouseScenePosRef.current = null;
    setMouseScenePosRef(null);
    setMouseScenePos(null);
  }, [clearPixelInfo, isMousePanning, setMouseScenePosRef]);

  const handleMouseLeave = () => {
    if (isScene3DMode) return;
    if (workingAreaInteraction.isDragging) return;
    if (interaction.hasGlobalMouseCapture()) return;
    clearPixelInfo();
    mouseScenePosRef.current = null;
    setMouseScenePosRef(null);
    setMouseScenePos(null);
    interaction.handleMouseLeave();
  };

  const sceneContainerStyle = useMemo<React.CSSProperties>(() => {
    if (!overlayViewSceneNode) return { display: 'none' };

    if (isCompareActive) {
      return {
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        transform: 'none',
      };
    }

    return {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: overlayViewSceneNode.width,
      height: overlayViewSceneNode.height,
      transform: `translate(calc(-50% + ${pan.x}px), calc(-50% - ${pan.y}px)) scale(${zoom})`,
    };
  }, [isCompareActive, overlayViewSceneNode, zoom, pan]);

  const viewportImageRendering = getViewportImageRendering(viewportInterpolation);
  const pixelGridZoom = getEffectiveViewportPixelZoom(zoom, stabilizationScale);

  const canvasStyle = useMemo<React.CSSProperties>(() => {
    if (!overlayViewSceneNode) return { display: 'none' };

    return {
      ...(viewportPresentation
        ? {
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            transform: 'none',
          }
        : sceneContainerStyle),
      imageRendering: viewportImageRendering,
      display: hasRenderableOutput ? 'block' : 'none',
    };
  }, [
    hasRenderableOutput,
    overlayViewSceneNode,
    sceneContainerStyle,
    viewportImageRendering,
    viewportPresentation,
  ]);

  const sceneContentStyle = useMemo<React.CSSProperties>(() => {
    if (!overlayViewSceneNode) return { display: 'none' };
    return {
      position: 'absolute',
      inset: 0,
    };
  }, [overlayViewSceneNode]);

  const displayWindowRect = useMemo(() => {
    const displayWindow = dataWindowProjection?.displayWindow ?? overlayViewSceneNode;
    if (!displayWindow) return null;
    return {
      x: 0,
      y: 0,
      width: displayWindow.width,
      height: displayWindow.height,
    };
  }, [dataWindowProjection, overlayViewSceneNode]);

  const cursorClass = isLoading
    ? 'cursor-wait'
    : isScrubbing
      ? 'cursor-ew-resize'
      : activeViewportTool === VIEWPORT_WORKING_AREA_TOOL && !isCompareActive
        ? 'cursor-crosshair'
        : (interaction.getCursor() ?? '');

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isScene3DMode) return;
    interaction.handleContextMenu?.({
      clientPoint: { x: e.clientX, y: e.clientY },
      scenePoint: { x: 0, y: 0 },
      button: e.button,
      modifiers: { alt: e.altKey, shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey },
      nativeEvent: e.nativeEvent,
    });
  };

  const refinementSimplifiedPoints = useMemo(() => {
    if (!rotoRefinement) return [];
    if (rotoRefinement.targetPathId) {
      const rotoIdx = nodes.findIndex((node) => node.id === selectedNodeId);
      const path = (nodes[rotoIdx] as RotoNode).paths.find(
        (p) => p.id === rotoRefinement.targetPathId,
      );
      if (path)
        return resamplePath(
          rotoRefinement.originalPoints,
          path.points.length,
          rotoRefinement.closed,
        );
    }
    return simplifyPath(rotoRefinement.originalPoints, rotoRefinement.epsilon);
  }, [rotoRefinement, nodes, selectedNodeId]);

  // --- Motion cues ---
  const {
    motionCueTargetPathIdSet,
    gradientTrailsByPath,
    speedHeatSegmentsByPath,
    motionBlurCuePathsByPath,
  } = useViewportMotionCues({
    rotoMotionCueEnabled,
    rotoMotionCueMode,
    rotoMotionCueScope,
    rotoMotionPathVisible,
    rotoMotionBlurPathVisible,
    rotoMotionTrailFrames,
    selectedNode,
    hierarchySelections,
    selectedNodeId,
    visualFrame,
    timelineStartFrame,
    maxFrames,
    rotoPointWeightMode,
    stabilizationMatrix,
  });

  const rotoInteraction = ctxRef.current.hooks.roto;
  const paintInteraction = ctxRef.current.hooks.paint;
  const warpInteraction = ctxRef.current.hooks.warp;
  const spatialInteraction = ctxRef.current.hooks.spatial;
  const comfyCropInteraction = ctxRef.current.hooks.comfyCrop;

  const { overlayContext, overlayContextRef } = useViewportOverlayContext({
    rotoInteraction,
    paintInteraction,
    warpInteraction,
    spatialInteraction,
    comfyCropInteraction,
    altPressed,
    affineModifierPressed,
    mouseScenePos,
    viewportSize,
    transformInputDataWindowRect,
    stabilizationMatrix,
    isDrawing,
    drawingRotoPath,
    rotoRefinement,
    refinementSimplifiedPoints,
    activeTrackingPoints,
    nudgeRadius,
    rotoPointWeightMode,
    rotoNudgeOverlayState: rotoInteraction.nudgeOverlayState,
    paintBrush,
    paintStrokePathsVisible,
    paintStrokePathsMode,
    selectedRotoLayerIds,
    selectedRotoPathIds,
    selectedRotoPointRefs,
    selectedPaintLayerIds,
    selectedPaintStrokeIds,
    selectedViewportNode: selectedOverlayViewNode,
    selectedNodeId,
    setSelectedRotoPointRefs,
    setHierarchySelection,
    motionCueTargetPathIdSet,
    gradientTrailsByPath,
    speedHeatSegmentsByPath,
    motionBlurCuePathsByPath,
    rotoMotionCueEnabled,
    rotoMotionCueMode,
    activeViewportTool,
    showOverlays,
  });

  // ── Wipe divider full-viewport line ─────────────────────────
  // Compute the divider position in viewport-space pixels for the overlay.
  const wipeDividerViewportPos = useMemo<number | null>(() => {
    if (!isCompareActive || compareView.mode !== 'wipe') return null;
    const ref = compareView.wipe.reference;
    const divPos = compareView.dividerPosition;

    if (ref === 'viewport' || ref === 'cursor') {
      return interactiveUVToViewportPixel(
        divPos,
        compareView.wipe.orientation,
        compareInteractiveViewportRect,
      );
    }

    if (!compareLeadingViewProjection) return null;
    // Canvas mode follows the currently displayed leading image.
    return presentationFrameUVToViewportPixel(
      divPos,
      compareView.wipe.orientation,
      compareLeadingViewProjection.frame,
    );
  }, [
    isCompareActive,
    compareView.mode,
    compareView.dividerPosition,
    compareView.wipe.orientation,
    compareView.wipe.reference,
    compareInteractiveViewportRect,
    compareLeadingViewProjection,
  ]);

  // ── Resolve overlay visibility from registry ──
  // Each node type declares whether the SVG container should render even
  // when showOverlays is off (e.g., roto/paint show cursor overlays during
  // active tools). This replaces hardcoded per-type if/else chains.
  const overlayVisibility = resolveOverlayVisibility(
    selectedOverlayViewNode,
    overlayContextRef.current,
  );
  const shouldRenderOverlaySvg = showOverlays || overlayVisibility.forceShowSvg;
  const sceneWindowLabels = (
    <ViewportWindowLabels
      visible={viewerSettings.showOverlays}
      zoom={overlayZoom}
      displayWindowRect={displayWindowRect}
      dataWindowRect={dataWindowRect}
      showDataWindow={Boolean(dataWindowNode)}
      dataWindowIsHandled={dataWindowIsHandled}
    />
  );
  const sceneSvgOverlays =
    shouldRenderOverlaySvg && overlayViewSceneNode ? (
      <ViewportSvgOverlays
        sceneNode={overlayViewSceneNode}
        selectedNode={selectedOverlayViewNode}
        viewerSettings={viewerSettings}
        activeViewportTool={activeViewportTool}
        overlayContext={overlayContext}
        zoom={overlayZoom}
        pan={overlayPan}
        visualFrame={visualFrame}
        displayWindowRect={displayWindowRect}
        dataWindowRect={dataWindowRect}
        dataWindowStyle={dataWindowIsHandled ? 'handled' : 'inherited'}
        stabilizationMatrix={stabilizationMatrix}
      />
    ) : null;

  return (
    <div
      ref={viewportRef}
      className={`relative w-full h-full flex items-center justify-center ${cursorClass}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onContextMenu={handleContextMenu}
    >
      {rotoRefinement && (
        <FreehandSmoothnessControl
          ref={smoothnessControlRef}
          epsilon={rotoRefinement.epsilon}
          isUpdate={!!rotoRefinement.targetPathId}
          onChange={handleSmoothnessChange}
          onCommit={commitRotoRefinement}
          position={(() => {
            const offset = 20,
              pW = panelWidth;
            const minLeft = pW + offset;
            const maxLeft = viewportSize.width - 224 - offset;
            if (!rotoRefinement.popupPosition)
              return {
                left: (viewportSize.width + pW - 224) / 2,
                top: (viewportSize.height - 80) / 2,
              };
            let { left, top } = rotoRefinement.popupPosition;
            left += offset;
            top += offset;
            if (left + 224 > viewportSize.width - offset)
              left = rotoRefinement.popupPosition.left - 224 - offset;
            if (top + 80 > viewportSize.height)
              top = rotoRefinement.popupPosition.top - 80 - offset;
            return {
              left: Math.max(minLeft, Math.min(left, maxLeft)),
              top: Math.max(offset, Math.min(top, viewportSize.height - 80 - offset)),
            };
          })()}
        />
      )}
      {renderSceneNode && activeScene3DNode && shouldMountScene3DViewport && (
        <Scene3DViewport
          sceneNode={renderSceneNode}
          scene3DNode={activeScene3DNode}
          projectColorManagement={projectColorManagement}
          selectedItemId={selectedScene3DItemId}
          backdropCanvas={gl?.domElement ?? canvasRef.current}
          hasBackdropOutput={hasScene3DBackdropOutput}
          isActive={isScene3DMode}
          viewportZoom={zoom}
          viewportPan={pan}
          viewportIsFit={isFit}
          viewportCameraMode={scene3DViewportCameraMode}
          onViewportCameraModeChange={setScene3DViewportCameraMode}
        />
      )}
      <div
        className="absolute inset-0 overflow-hidden pointer-events-none"
        style={{ visibility: isScene3DMode ? 'hidden' : 'visible' }}
      >
        <ViewportBackground
          mode={viewportBackgroundMode}
          color={viewportBackgroundColor}
          className="absolute inset-0"
        />
        <canvas ref={canvasRef} style={canvasStyle} />
        {overlayViewSceneNode ? (
          <div style={sceneContainerStyle}>
            <div style={sceneContentStyle}>
              <ViewportPixelGrid
                enabled={
                  viewportPixelGridEnabled &&
                  !isCompareActive &&
                  !viewportPresentation &&
                  hasRenderableOutput
                }
                zoom={pixelGridZoom}
                thresholdZoom={viewportPixelGridZoomThresholdPercent / 100}
                style={stabilizationTransformStyle}
              />
              {!isCompareActive && (
                <div className="absolute inset-0" style={stabilizationTransformStyle}>
                  {sceneWindowLabels}
                  {(viewportWorkingArea.enabled || workingAreaInteraction.draftRect) && (
                    <WorkingAreaOverlay
                      rect={workingAreaInteraction.draftRect ?? viewportWorkingArea.rect}
                      scene={sceneNode}
                      zoom={zoom}
                      editable={activeViewportTool === VIEWPORT_WORKING_AREA_TOOL}
                    />
                  )}
                </div>
              )}
              {!hasRenderableOutput && (
                <div className="absolute inset-0 flex items-center justify-center p-4">
                  <div
                    className="text-gray-500 z-10 text-center p-6 border-2 border-dashed border-gray-700 rounded-lg bg-gray-900/50"
                    style={{
                      transform: `scale(${1 / zoom})`,
                      transformOrigin: 'center',
                    }}
                  >
                    <p className="font-semibold text-lg text-gray-400">Empty Scene</p>
                    <p className="text-sm mt-4">
                      The scene is defined, but contains no image data.
                    </p>
                    <p className="text-sm mt-1">
                      Click "Open" or drag & drop a file to add an image node.
                    </p>
                  </div>
                </div>
              )}
              {rendererError && (
                <div className="absolute inset-0 flex items-center justify-center p-4">
                  <div
                    className="z-10 max-w-sm rounded-lg border border-amber-400/30 bg-gray-950/90 p-4 text-center shadow-xl"
                    style={{
                      transform: `scale(${1 / zoom})`,
                      transformOrigin: 'center',
                    }}
                  >
                    <p className="font-semibold text-amber-100">Viewport renderer unavailable</p>
                    <p className="mt-2 text-sm leading-5 text-amber-50/75">{rendererError}</p>
                    <p className="mt-2 text-xs leading-5 text-gray-400">
                      Chats, project branches, and agent tools can still be used. Enable WebGL2 or
                      hardware acceleration to render the viewport.
                    </p>
                  </div>
                </div>
              )}
            </div>
            {!isCompareActive && sceneSvgOverlays}
            {isCompareActive && compareLeadingViewProjection && overlayViewSceneNode && (
              <ViewportSceneOverlayFrame
                sceneSize={overlayViewSceneNode}
                frame={compareLeadingViewProjection.frame}
                clipRect={compareLeadingViewProjection.clipRect}
              >
                {sceneWindowLabels}
                {sceneSvgOverlays}
              </ViewportSceneOverlayFrame>
            )}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500">
            <p>Loading project...</p>
          </div>
        )}
      </div>

      {isCompareActive && (
        <ViewportCompareOverlays
          visible={viewerSettings.showOverlays}
          mode={compareView.mode}
          orientation={compareView.wipe.orientation}
          wipeDividerViewportPos={wipeDividerViewportPos}
          compareInteractiveViewportRect={compareInteractiveViewportRect}
        />
      )}

      {selectedOverlayViewNode && overlayViewSceneNode && !isScene3DMode && (
        <ViewportOverlayRenderer
          node={selectedOverlayViewNode}
          mode="html"
          overlayProps={{
            node: selectedOverlayViewNode,
            frame: visualFrame,
            zoom: overlayZoom,
            pan: overlayPan,
            scene: { width: overlayViewSceneNode.width, height: overlayViewSceneNode.height },
            activeTool: activeViewportTool,
            context: overlayContext,
          }}
        />
      )}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          left: 'var(--panel-width, 0px)',
          bottom: 'calc(var(--bottom-tray-height, 48px) + var(--timeline-height, 0px))',
        }}
      >
        {isLoading && (
          <div className="absolute top-4 right-4 z-50 pointer-events-none">
            <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}
        {activeScene3DNode && (
          <div className="pointer-events-auto absolute top-1.5 left-2 z-30 flex items-center gap-1.5">
            <ViewportModeSwitch scene3DNode={activeScene3DNode} />
            {isScene3DMode && (
              <ViewportCameraSelector
                value={scene3DViewportCameraMode}
                onChange={setScene3DViewportCameraMode}
              />
            )}
          </div>
        )}
        {hasRenderableOutput && !isScene3DMode && <ViewportSettingsBar />}
        {overlayViewSceneNode && !isScene3DMode && (
          <ViewportControls visible={!isFit} onFit={fitToView} zoomValue={overlayZoom} />
        )}
        {!isCompareActive &&
          !isFit &&
          overlayViewSceneNode &&
          hasRenderableOutput &&
          !isScene3DMode && (
            <Minimap
              sourceCanvas={gl?.domElement ?? canvasRef.current}
              viewportSize={viewportSize}
              sceneSize={{ width: overlayViewSceneNode.width, height: overlayViewSceneNode.height }}
              previewRefreshToken={minimapPreviewRefreshToken}
            />
          )}
        {overlayViewSceneNode && !isScene3DMode && (
          <PixelInspector info={pixelInfo} bitDepth={overlayViewSceneNode.bitDepth} />
        )}
      </div>
      {isDragging && (
        <div className="absolute inset-0 bg-black/50 z-20 flex items-center justify-center pointer-events-none">
          <p className="text-white text-lg font-semibold">Drop media to open</p>
        </div>
      )}
    </div>
  );
}

export default Viewport;
