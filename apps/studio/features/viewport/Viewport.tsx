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
  type ComfyNode,
  type PaintNode,
  type RotoNode,
  type Scene3DNode,
  type SceneNode,
} from '@blackboard/types';
import ViewportSettingsBar from './ViewportSettingsBar';
import ViewportBackground from '@/components/ViewportBackground';
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
import { useViewportPaintTextures } from '@/hooks/viewport/useViewportPaintTextures';
import { useViewportRotoMasks } from '@/hooks/viewport/useViewportRotoMasks';
import { useViewportVideoSync } from '@/hooks/viewport/useViewportVideoSync';
import { useViewportGestures } from '@/hooks/viewport/useViewportGestures';
import { useViewportRenderLoop } from '@/hooks/viewport/useViewportRenderLoop';
import { useViewportScene3DAssets } from '@/hooks/viewport/useViewportScene3DAssets';
import { useViewportScrubbing } from '@/hooks/viewport/useViewportScrubbing';
import { useViewportMotionCues } from '@/hooks/viewport/useViewportMotionCues';
import { useRotoTemporalPreview } from '@/hooks/viewport/useRotoTemporalPreview';
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
} from '@/utils/viewerSlots';
import { expandGroupNodesForRender } from '@/utils/groupRenderProjection';
import { useRotoItemsClipboard } from '@/nodes/builtin/roto/rotoItemsClipboard';
import { usePaintItemsClipboard } from '@/nodes/builtin/paint/paintItemsClipboard';
import {
  createStandardClipboardHotkeyBindings,
  createStandardClipboardHotkeyCommands,
} from '@/utils/standardClipboardHotkeys';
import { stabilizePoint } from '@/utils/rotoTracking';
import { getAllProjectNodes } from '@/state/editor/flowModel';
import { resolveRenderOutputDomain } from '@/color-management';

type ViewportMouseEvent = MouseEvent | React.MouseEvent<HTMLDivElement>;

const formatDataWindowSize = (width: number, height: number) =>
  `${Math.round(Math.abs(width))} x ${Math.round(Math.abs(height))}`;

const dataWindowSizeChanged = (rect: {
  width: number;
  height: number;
  nativeWidth: number;
  nativeHeight: number;
}) =>
  Math.round(Math.abs(rect.width)) !== Math.round(Math.abs(rect.nativeWidth)) ||
  Math.round(Math.abs(rect.height)) !== Math.round(Math.abs(rect.nativeHeight));

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
  const isFrameScrubbing = useEditorSelector((s) => s.isFrameScrubbing);
  const activeViewportTool = useEditorSelector((s) => s.activeViewportTool);
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
    rotoMotionBlurInteractivePreviewEnabled,
    rotoFrameChangePreviewEnabled,
    rotoPreviewRefineDelayMs,
    rotoPlaybackPreviewMode,
    rotoInteractivePreviewMaxDimension,
    rotoMotionBlurInteractivePreviewSamples,
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
  const cacheRetentionNodes = useMemo(() => getAllProjectNodes(flows), [flows]);
  const renderSceneNode = useMemo(
    () => renderNodes.find((node): node is SceneNode => node.type === NodeType.SCENE) ?? sceneNode,
    [renderNodes, sceneNode],
  );
  const isScene3DProjectionViewActive =
    isScene3DMode && scene3DViewportCameraMode === 'sceneCamera';
  const gestureSceneNode = isScene3DMode ? renderSceneNode : sceneNode;
  const selectedScene3DItemId = activeScene3DNode
    ? (hierarchySelections[activeScene3DNode.id]?.itemIds?.[0] ?? null)
    : null;
  const hasRenderableOutput = useMemo(() => hasRenderableNodes(renderNodes), [renderNodes]);
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
    activeNodes: renderNodes,
    retentionNodes: cacheRetentionNodes,
    currentFrame,
    selectedNode,
    maxFrames,
    updateCacheStatus,
    fps,
  });
  const { temporalPreviewActive, reportPrepareDuration, reportRenderDuration } =
    useRotoTemporalPreview({
      currentFrame,
      fps,
      isPlaying,
      isFrameScrubbing,
      frameChangePreviewEnabled: rotoFrameChangePreviewEnabled,
      refineDelayMs: rotoPreviewRefineDelayMs,
      playbackMode: rotoPlaybackPreviewMode,
    });
  const dataWindowProjection = useMemo(
    () => (sceneNode ? getDataWindowProjection(sceneNode, viewportNodes, visualFrame) : null),
    [sceneNode, viewportNodes, visualFrame],
  );
  const dataWindowNode = selectedViewportNode ?? selectedNode;
  const dataWindowRect =
    dataWindowNode && nodeFlags(dataWindowNode.type).showDataWindow
      ? (dataWindowProjection?.outputs.get(dataWindowNode.id) ?? null)
      : null;
  const transformInputDataWindowRect =
    dataWindowNode && nodeFlags(dataWindowNode.type).showInputDataWindow
      ? (dataWindowProjection?.inputs.get(dataWindowNode.id) ?? null)
      : null;

  const textTexturesRef = useViewportTextTextures({
    nodes: renderNodes,
    currentFrame: visualFrame,
    bumpMediaUpdate: bumpMediaUpdateTrigger,
  });

  // --- Video sync ---
  useViewportVideoSync({ nodes, currentFrame, isPlaying, playbackDirection, fps, textureCacheRef });

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

  const { stabilizationMatrix, stabilizedSceneStyle, viewportToSceneCentered } =
    useViewportStabilization({
      isStabilized,
      stabilizationReference,
      stabilizationReferenceFrame,
      stabilizationConfig,
      selectedNode,
      hierarchySelections,
      selectedNodeId,
      sceneNode,
      visualFrame,
      viewportInterpolation,
      pan,
      zoom,
      viewportRef,
      recaptureStabilizationReference,
    });

  const [pixelInfo, setPixelInfo] = useState<ViewportPixelInfo | null>(null);

  // --- Unified interaction hooks ---
  const { interaction, ctxRef } = useViewportInteractions({
    selectedNode,
    selectedNodeId,
    nodes,
    sceneNode,
    projectColorManagement,
    selectedRotoLayerIds,
    selectedRotoPathIds,
    selectedRotoPointRefs,
    selectedPaintLayerIds,
    selectedPaintStrokeIds,
    zoom,
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
  const paintTexturesRef = useViewportPaintTextures({
    nodes: renderNodes,
    currentFrame: visualFrame,
    sceneNode: renderSceneNode,
    projectColorManagement,
    livePreview: paintLivePreview,
    bumpMediaUpdate: bumpMediaUpdateTrigger,
  });

  const isInteractiveRotoPreviewActive = interaction.isPreviewActive?.() ?? false;
  const freezeRotoMaskWhileEditing =
    isInteractiveRotoPreviewActive &&
    viewerSettings.channels !== 'A' &&
    !viewerSettings.alphaOverlay;

  const rotoMaskTexturesRef = useViewportRotoMasks({
    nodes: renderNodes,
    sceneNode: renderSceneNode,
    viewportSize,
    currentFrame: visualFrame,
    interactiveMotionBlurPreviewEnabled: rotoMotionBlurInteractivePreviewEnabled,
    interactiveMotionBlurPreviewActive: isInteractiveRotoPreviewActive,
    interactiveNodeId: isInteractiveRotoPreviewActive ? (selectedNodeId ?? null) : null,
    interactiveMaxDimension: rotoInteractivePreviewMaxDimension,
    interactiveMotionBlurPreviewSamples: rotoMotionBlurInteractivePreviewSamples,
    temporalPreviewActive,
    reportPrepareDuration,
    rotoPointWeightMode,
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

  useViewportScene3DAssets({
    renderer: gl,
    nodes: renderNodes,
    sceneNode: renderSceneNode,
    projectColorManagement,
    onAssetsReady: bumpMediaUpdateTrigger,
  });

  const { finalCompBufferRef } = useViewportRenderLoop({
    gl,
    canvasRef,
    rendererSurfaceSize: rendererViewportSize,
    nodes: renderNodes,
    sceneNode: renderSceneNode,
    visualFrame,
    viewerSettings,
    displayView: currentViewerDisplayView,
    projectColorManagement,
    outputDomain: renderOutputDomain,
    alphaOverlayStyle,
    hasRenderableNodes: hasRenderableOutput,
    isRenderReady,
    mediaUpdateTrigger,
    threeStuff,
    textureCacheRef,
    textTexturesRef,
    paintTexturesRef,
    rotoMaskTexturesRef,
    freezeImageWhileEditing: freezeRotoMaskWhileEditing,
    deferProjectThumbnailCapture:
      isScene3DMode || isFrameScrubbing || isInteractiveRotoPreviewActive,
    signalFrameRendered: handleFrameRendered,
    reportRenderDuration,
    setProjectThumbnail,
  });

  const {
    clearPixelInfo,
    setMouseScenePosRef,
    updatePixelInfoAtScenePos,
    refreshPixelInfoAfterRender,
  } = useViewportPixelInspector({
    gl,
    finalCompBufferRef,
    sceneNode: renderSceneNode,
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
  const showOverlays = viewerSettings.showOverlays || showInteractionOverlays;

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
  });

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

    const mousePos = getViewportMousePos(e.clientX, e.clientY);
    if (!mousePos) return;
    const scenePos = viewportToSceneCentered(mousePos);

    // Delegate to unified interaction (returns true if consumed)
    if (
      interaction.handleMouseDown({
        clientX: e.clientX,
        clientY: e.clientY,
        sceneX: scenePos.x,
        sceneY: scenePos.y,
        button: e.button,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        nativeEvent: e.nativeEvent,
      })
    )
      return;

    // Middle Mouse Button Logic (common viewport behaviour)
    if (handleViewportPanMouseDown(e)) return;
  };

  const [isDragging, setIsDragging] = useState(false);
  const lastHandledMouseEventRef = useRef<MouseEvent | null>(null);

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

      // Delegate to unified interaction (returns true if consumed)
      if (
        interaction.handleMouseMove({
          clientX: e.clientX,
          clientY: e.clientY,
          sceneX: scenePos.x,
          sceneY: scenePos.y,
          button: e.button,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
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
    ],
  );

  const handleMouseUp = useCallback(
    (e: ViewportMouseEvent) => {
      const nativeEvent = getNativeMouseEvent(e);
      if (lastHandledMouseEventRef.current === nativeEvent) return;
      lastHandledMouseEventRef.current = nativeEvent;

      if (isScene3DMode) return;
      if (isLoading) return;
      interaction.handleMouseUp({
        clientX: e.clientX,
        clientY: e.clientY,
        sceneX: 0,
        sceneY: 0,
        button: e.button,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        nativeEvent,
      });
    },
    [getNativeMouseEvent, isScene3DMode, isLoading, interaction],
  );

  useEffect(() => {
    if (!interaction.hasGlobalMouseCapture()) return;

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
  }, [handleMouseMove, handleMouseUp, interaction]);

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
    if (interaction.hasGlobalMouseCapture()) return;
    clearPixelInfo();
    mouseScenePosRef.current = null;
    setMouseScenePosRef(null);
    setMouseScenePos(null);
    interaction.handleMouseLeave();
  };

  const canvasContainerStyle = useMemo<React.CSSProperties>(() => {
    if (!sceneNode) return { display: 'none' };
    return {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: sceneNode.width,
      height: sceneNode.height,
      transform: `translate(calc(-50% + ${pan.x}px), calc(-50% - ${pan.y}px)) scale(${zoom})`,
    };
  }, [sceneNode, zoom, pan]);

  const displayWindowRect = useMemo(() => {
    if (!sceneNode) return null;
    return {
      x: 0,
      y: 0,
      width: sceneNode.width,
      height: sceneNode.height,
    };
  }, [sceneNode]);

  /** Transform absolute scene corners through the stabilization matrix. */
  const stabilizeBboxCorners = useCallback(
    (x: number, y: number, w: number, h: number) => {
      if (!sceneNode) return null;
      const cx = sceneNode.width / 2;
      const cy = sceneNode.height / 2;
      // Convert to scene-centered coords, stabilize, convert back
      const tl = stabilizePoint({ x: x - cx, y: y - cy }, stabilizationMatrix);
      const tr = stabilizePoint({ x: x + w - cx, y: y - cy }, stabilizationMatrix);
      const br = stabilizePoint({ x: x + w - cx, y: y + h - cy }, stabilizationMatrix);
      const bl = stabilizePoint({ x: x - cx, y: y + h - cy }, stabilizationMatrix);
      return [
        { x: tl.x + cx, y: tl.y + cy },
        { x: tr.x + cx, y: tr.y + cy },
        { x: br.x + cx, y: br.y + cy },
        { x: bl.x + cx, y: bl.y + cy },
      ];
    },
    [sceneNode, stabilizationMatrix],
  );

  const cursorClass = isLoading
    ? 'cursor-wait'
    : isScrubbing
      ? 'cursor-ew-resize'
      : (interaction.getCursor() ?? '');

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isScene3DMode) return;
    interaction.handleContextMenu?.({
      clientX: e.clientX,
      clientY: e.clientY,
      sceneX: 0,
      sceneY: 0,
      button: e.button,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
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
    selectedViewportNode,
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

  // ── Resolve overlay visibility from registry ──
  // Each node type declares whether the SVG container should render even
  // when showOverlays is off (e.g., roto/paint show cursor overlays during
  // active tools). This replaces hardcoded per-type if/else chains.
  const overlayVisibility = resolveOverlayVisibility(selectedNode, overlayContextRef.current);
  const shouldRenderOverlaySvg = showOverlays || overlayVisibility.forceShowSvg;

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
        {sceneNode ? (
          <div style={canvasContainerStyle}>
            <div style={stabilizedSceneStyle}>
              <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 w-full h-full"
                style={{
                  imageRendering: viewportInterpolation === 'nearest' ? 'pixelated' : 'auto',
                  display: hasRenderableOutput ? 'block' : 'none',
                }}
              />
              {viewerSettings.showOverlays && (
                <div className="absolute inset-0 pointer-events-none">
                  {displayWindowRect && displayWindowRect.width > 150 && (
                    <div
                      className="absolute top-0 left-0 bg-cyan-900/80 text-cyan-200 text-[10px] px-1.5 py-0.5 font-mono"
                      style={{
                        left: displayWindowRect.x,
                        top: displayWindowRect.y,
                        transform: `translate(${-1 / zoom}px, -100%) scale(${1 / zoom})`,
                        transformOrigin: 'bottom left',
                      }}
                    >
                      <span className="text-cyan-300">Display Window</span>{' '}
                      <span className="text-cyan-100">
                        {formatDataWindowSize(displayWindowRect.width, displayWindowRect.height)}
                      </span>
                    </div>
                  )}
                  {selectedNode && dataWindowRect && dataWindowRect.width > 150 && (
                    <div
                      className="absolute bg-amber-950/90 text-amber-200 text-[10px] px-1.5 py-0.5 font-mono shadow-sm shadow-black/30"
                      style={{
                        left: dataWindowRect.x,
                        top: dataWindowRect.y,
                        transform: `translate(${-1 / zoom}px, -100%) scale(${1 / zoom})`,
                        transformOrigin: 'bottom left',
                      }}
                      title={`Data Window: ${formatDataWindowSize(
                        dataWindowRect.width,
                        dataWindowRect.height,
                      )}${
                        dataWindowSizeChanged(dataWindowRect)
                          ? `. Native before this node: ${formatDataWindowSize(
                              dataWindowRect.nativeWidth,
                              dataWindowRect.nativeHeight,
                            )}`
                          : ''
                      }`}
                    >
                      <span className="text-amber-300">Data Window</span>{' '}
                      <span className="whitespace-nowrap text-amber-100">
                        {formatDataWindowSize(dataWindowRect.width, dataWindowRect.height)}
                        {dataWindowSizeChanged(dataWindowRect) && (
                          <span className="text-amber-100/70">
                            <svg
                              aria-hidden="true"
                              className="mx-1 inline-block h-2 w-3 align-[-1px]"
                              fill="none"
                              viewBox="0 0 14 10"
                            >
                              <path
                                d="M13 5H1.5m0 0L5 1.5M1.5 5L5 8.5"
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="1"
                              />
                            </svg>
                            {formatDataWindowSize(
                              dataWindowRect.nativeWidth,
                              dataWindowRect.nativeHeight,
                            )}
                          </span>
                        )}
                      </span>
                    </div>
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
            {shouldRenderOverlaySvg && (
              <svg
                className={`absolute top-0 left-0 w-full h-full pointer-events-none`}
                viewBox={`0 0 ${sceneNode.width} ${sceneNode.height}`}
                style={{ overflow: 'visible' }}
              >
                {/* Display Window border (cyan) */}
                {viewerSettings.showOverlays &&
                  (() => {
                    if (!displayWindowRect) return null;
                    const corners = stabilizeBboxCorners(
                      displayWindowRect.x,
                      displayWindowRect.y,
                      displayWindowRect.width,
                      displayWindowRect.height,
                    );
                    if (!corners) return null;
                    const pts = corners.map((p) => `${p.x},${p.y}`).join(' ');
                    return (
                      <>
                        <polygon
                          points={pts}
                          fill="none"
                          stroke="rgb(34 211 238 / 0.5)"
                          strokeWidth={1 / zoom}
                        />
                      </>
                    );
                  })()}
                {/* Data Window border (amber/dashed) */}
                {viewerSettings.showOverlays &&
                  dataWindowRect &&
                  (() => {
                    const corners = stabilizeBboxCorners(
                      dataWindowRect.x,
                      dataWindowRect.y,
                      dataWindowRect.width,
                      dataWindowRect.height,
                    );
                    if (!corners) return null;
                    const pts = corners.map((p) => `${p.x},${p.y}`).join(' ');
                    return (
                      <>
                        <polygon
                          points={pts}
                          fill="none"
                          stroke="rgb(251 191 36 / 0.8)"
                          strokeWidth={2 / zoom}
                          strokeDasharray={`${6 / zoom} ${4 / zoom}`}
                        />
                      </>
                    );
                  })()}
                {/* Direct SVG overlays (absolute scene coordinates, outside <g>) */}
                {selectedNode && (
                  <ViewportOverlayRenderer
                    node={selectedNode}
                    mode="svg-direct"
                    overlayProps={{
                      node: selectedNode,
                      frame: visualFrame,
                      zoom,
                      pan,
                      scene: { width: sceneNode.width, height: sceneNode.height },
                      activeTool: activeViewportTool,
                      context: overlayContext,
                    }}
                  />
                )}
                <g transform={`translate(${sceneNode.width / 2}, ${sceneNode.height / 2})`}>
                  {selectedNode && (
                    <ViewportOverlayRenderer
                      node={selectedNode}
                      mode="svg"
                      overlayProps={{
                        node: selectedNode,
                        frame: visualFrame,
                        zoom,
                        pan,
                        scene: { width: sceneNode.width, height: sceneNode.height },
                        activeTool: activeViewportTool,
                        context: overlayContext,
                      }}
                    />
                  )}
                </g>
              </svg>
            )}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500">
            <p>Loading project...</p>
          </div>
        )}
      </div>
      {selectedNode && !isScene3DMode && (
        <ViewportOverlayRenderer
          node={selectedNode}
          mode="html"
          overlayProps={{
            node: selectedNode,
            frame: visualFrame,
            zoom,
            pan,
            scene: { width: sceneNode.width, height: sceneNode.height },
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
        {sceneNode && !isScene3DMode && (
          <ViewportControls visible={!isFit} onFit={fitToView} zoomValue={zoom} />
        )}
        {!isFit && sceneNode && hasRenderableOutput && !isScene3DMode && (
          <Minimap
            sourceCanvas={gl?.domElement ?? canvasRef.current}
            viewportSize={viewportSize}
            sceneSize={{ width: sceneNode.width, height: sceneNode.height }}
            previewRefreshToken={minimapPreviewRefreshToken}
          />
        )}
        {sceneNode && !isScene3DMode && (
          <PixelInspector info={pixelInfo} bitDepth={sceneNode.bitDepth} />
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
