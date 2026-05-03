import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { PixelInspector } from '@blackboard/ui';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { usePreferences, colors } from '@/state/preferencesContext';
import { useSceneNode, useSelectedEditorNode } from '@/hooks/useEditorNodes';
import ViewportControls from './ViewportControls';
import Minimap from './Minimap';
import { NodeType, type PaintNode, type RotoNode, type WarpNode } from '@blackboard/types';
import { getRotoPathParentLayerId } from '@/utils/rotoHierarchy';
import ViewportSettingsBar from './ViewportSettingsBar';
import * as THREE from 'three';
import { getValueAtFrame } from '@blackboard/renderer';
import { simplifyPath, resamplePath } from '@/utils/bspline';
import FreehandSmoothnessControl from '@/effects/roto/FreehandSmoothnessControl';
import WarpOverlay from '@/effects/warp/WarpOverlay';
import RotoOverlay, { type NudgeOverlayState } from '@/effects/roto/RotoOverlay';
import PaintOverlay from '@/effects/paint/PaintOverlay';
import { useViewportRenderer } from '@/hooks/viewport/useViewportRenderer';
import { useViewportMediaCache } from '@/hooks/viewport/useViewportMediaCache';
import { useViewportTextTextures } from '@/hooks/viewport/useViewportTextTextures';
import { useViewportPaintTextures } from '@/hooks/viewport/useViewportPaintTextures';
import { useViewportRotoMasks } from '@/hooks/viewport/useViewportRotoMasks';
import { useViewportVideoSync } from '@/hooks/viewport/useViewportVideoSync';
import { useViewportGestures } from '@/hooks/viewport/useViewportGestures';
import { useViewportRenderLoop } from '@/hooks/viewport/useViewportRenderLoop';
import { useViewportScrubbing } from '@/hooks/viewport/useViewportScrubbing';
import { useViewportMotionCues } from '@/hooks/viewport/useViewportMotionCues';
import { effectRegistry } from '@/effects/effectRegistry';
import {
  useHotkeyScope,
  useKeyboardState,
  useRegisterHotkeyCommands,
  useRegisterHotkeys,
  type HotkeyBinding,
  type HotkeyCommand,
} from '@/hotkeys';
import { hasRenderableNodes, nodeFlags, getMediaDescriptor } from '@/effects/effectHelpers';
import { getTransformHandleCursor } from '@/utils/rotoTransform';
import { useWarpInteraction } from '@/effects/warp/useWarpInteraction';
import { getMediaFileKind } from '@/utils/mediaFiles';
import { useBokehInteraction } from '@/effects/bokeh/useBokehInteraction';
import { useRotoInteraction } from '@/effects/roto/useRotoInteraction';
import { usePaintInteraction } from '@/effects/paint/usePaintInteraction';
import { getViewerRenderNodes } from '@/utils/viewerSlots';
import { useRotoItemsClipboard } from '@/effects/roto/rotoItemsClipboard';
import { usePaintItemsClipboard } from '@/effects/paint/paintItemsClipboard';
import {
  createStandardClipboardHotkeyBindings,
  createStandardClipboardHotkeyCommands,
} from '@/utils/standardClipboardHotkeys';
import {
  applyRotoTrackingMatrix4ToPoint,
  formatRotoTrackingMatrix4AsCssMatrix3d,
  invertRotoTrackingMatrix4,
  multiplyRotoTrackingMatrix4,
  reduceRotoTrackingMatrix4ToComponents,
  stabilizePoint,
} from '@/utils/rotoTracking';

type ViewportMouseEvent = MouseEvent | React.MouseEvent<HTMLDivElement>;

const Viewport: React.FC = () => {
  // — State: subscribe to individual slices so the component only re-renders
  //   when the specific value changes (not on every store update).
  const projectId = useEditorSelector((s) => s.projectId);
  const nodes = useEditorSelector((s) => s.nodes);
  const zoom = useEditorSelector((s) => s.zoom);
  const pan = useEditorSelector((s) => s.pan);
  const targetZoom = useEditorSelector((s) => s.targetZoom);
  const targetPan = useEditorSelector((s) => s.targetPan);
  const viewerSettings = useEditorSelector((s) => s.viewerSettings);
  const viewerNodeId = useEditorSelector((s) => s.viewerNodeId);
  const selectedNodeId = useEditorSelector((s) => s.selectedNodeId);
  const selectedPaintLayerIds = useEditorSelector((s) => s.selectedPaintLayerIds);
  const selectedPaintStrokeIds = useEditorSelector((s) => s.selectedPaintStrokeIds);
  const selectedRotoLayerIds = useEditorSelector((s) => s.selectedRotoLayerIds);
  const selectedRotoPathIds = useEditorSelector((s) => s.selectedRotoPathIds);
  const selectedRotoPointRefs = useEditorSelector((s) => s.selectedRotoPointRefs);
  const isPlaying = useEditorSelector((s) => s.isPlaying);
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
    setZoom,
    setPan,
    setAnimationTarget,
    setProjectThumbnail,
    updateNode,
    setActiveViewportTool,
    setSelectedRotoPathIds,
    setSelectedRotoSelection,
    setSelectedPaintLayerIds,
    setSelectedPaintStrokeIds,
    pushHistory,
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
  const {
    primaryColor,
    rotoMotionCueEnabled,
    rotoMotionCueMode,
    rotoMotionCueScope,
    rotoMotionPathVisible,
    rotoMotionBlurPathVisible,
    rotoMotionTrailFrames,
    rotoMotionBlurPreviewBackend,
    rotoMotionBlurInteractivePreviewEnabled,
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
    viewportInterpolation,
    setPreferences,
  } = usePreferences();

  const sceneNode = useSceneNode();
  const selectedNode = useSelectedEditorNode();
  const viewportNodes = useMemo(
    () => getViewerRenderNodes(nodes, viewerNodeId),
    [nodes, viewerNodeId],
  );
  const hasRenderableOutput = useMemo(() => hasRenderableNodes(viewportNodes), [viewportNodes]);

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
  const altPressed = useKeyboardState((snapshot) => snapshot.modifiers.alt);
  const shiftPressed = useKeyboardState((snapshot) => snapshot.modifiers.shift);
  const affineModifierPressed = useKeyboardState(
    (snapshot) => snapshot.modifiers.ctrl || snapshot.modifiers.meta,
  );

  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useHotkeyScope({ id: 'viewport', ref: viewportRef });

  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [pixelInfo, setPixelInfo] = useState<{
    x: number;
    y: number;
    color: [number, number, number, number];
  } | null>(null);
  const pixelReadBuffer8Ref = useRef(new Uint8Array(4));
  const pixelReadBuffer16Ref = useRef(new Uint16Array(4));
  const pixelReadBuffer32Ref = useRef(new Float32Array(4));

  const handleSmoothnessChange = (newEpsilon: number) => {
    updateRotoRefinement({ epsilon: newEpsilon });
  };

  const threeStuff = useRef({
    scene: new THREE.Scene(),
    camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10),
    plane: new THREE.PlaneGeometry(2, 2),
    materials: new Map<string, THREE.ShaderMaterial>(),
    renderTargets: [] as THREE.WebGLRenderTarget[],
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

  const { textureCacheRef, mediaUpdateTrigger, bumpMediaUpdateTrigger } = useViewportMediaCache({
    nodes: nodes,
    currentFrame,
    selectedNode,
    maxFrames,
    updateCacheStatus,
    fps,
  });

  const checkFrameReady = useCallback(
    (frame: number) => {
      if (!viewportNodes || viewportNodes.length === 0) return true;

      const visibleNodes = viewportNodes.filter((node) => node.visible);

      for (const node of visibleNodes) {
        const desc = getMediaDescriptor(node.type);
        if (desc) {
          const caches = {
            imageCache: textureCacheRef.current,
            videoElements: new Map<string, HTMLVideoElement>(
              Array.from(textureCacheRef.current.entries())
                .filter(([, v]) => v?.video)
                .map(([k, v]) => [k, v.video!]),
            ),
            sequenceCache: textureCacheRef.current,
          };
          if (!desc.checkFrameReady(node, frame, caches)) return false;
        }
      }
      return true;
    },
    [viewportNodes, textureCacheRef],
  );

  const [visualFrame, setVisualFrame] = useState(currentFrame);

  useLayoutEffect(() => {
    if (checkFrameReady(currentFrame)) {
      setVisualFrame(currentFrame);
    }
  }, [currentFrame, mediaUpdateTrigger, checkFrameReady]);

  const isLoading = visualFrame !== currentFrame;

  const textTexturesRef = useViewportTextTextures({
    nodes: viewportNodes,
    currentFrame: visualFrame,
    bumpMediaUpdate: bumpMediaUpdateTrigger,
  });

  // --- Video sync ---
  useViewportVideoSync({ nodes, currentFrame, isPlaying, fps, textureCacheRef });

  // --- Scrubbing ---
  const { isScrubbing, startScrub } = useViewportScrubbing({
    currentFrame,
    seekFrame,
    setFrameScrubbing,
  });

  // --- Recapture stabilisation reference when roto selection changes ---
  const prevRotoSelectionRef = useRef({
    pathIds: selectedRotoPathIds,
    layerIds: selectedRotoLayerIds,
  });
  useEffect(() => {
    const prev = prevRotoSelectionRef.current;
    prevRotoSelectionRef.current = {
      pathIds: selectedRotoPathIds,
      layerIds: selectedRotoLayerIds,
    };

    if (!isStabilized || !selectedNode) return;

    const prevKey = [...prev.pathIds, ...prev.layerIds].sort().join(',');
    const nextKey = [...selectedRotoPathIds, ...selectedRotoLayerIds].sort().join(',');
    if (prevKey === nextKey) return;

    const scope = stabilizationConfig.scope;

    if (scope === 'parent') {
      const rotoNode = selectedNode as RotoNode;

      const resolveParentLayer = (pathIds: string[], layerIds: string[]): string | null => {
        if (pathIds.length === 1) {
          const path = rotoNode.paths.find((p) => p.id === pathIds[0]);
          return path ? getRotoPathParentLayerId(rotoNode, path) : null;
        }
        if (layerIds.length === 1) {
          const layer = rotoNode.layers?.find((l) => l.id === layerIds[0]);
          return layer?.parentLayerId ?? null;
        }
        return null;
      };

      const prevParent = resolveParentLayer(prev.pathIds, prev.layerIds);
      const nextParent = resolveParentLayer(selectedRotoPathIds, selectedRotoLayerIds);
      if (prevParent !== null && nextParent !== null && prevParent === nextParent) return;
    }

    recaptureStabilizationReference();
  }, [
    isStabilized,
    selectedNode,
    selectedRotoPathIds,
    selectedRotoLayerIds,
    stabilizationConfig.scope,
    recaptureStabilizationReference,
  ]);

  const stabilizationMatrix = useMemo<number[][] | null>(() => {
    if (!isStabilized || !stabilizationReference || !selectedNode) return null;
    const def = effectRegistry.get(selectedNode.type);
    if (def && def.getStabilizeTransform) {
      const currentTransform = def.getStabilizeTransform(selectedNode, visualFrame, {
        stabilizationConfig,
        selectedRotoLayerIds,
        selectedRotoPathIds,
        stabilizationReferenceFrame,
      });
      if (currentTransform) {
        const buildScalarTransformMatrix = (transform: {
          x: number;
          y: number;
          scale: number;
          rotation: number;
        }) => {
          const scale = Number.isFinite(transform.scale) ? transform.scale : 1;
          const rotation = Number.isFinite(transform.rotation) ? transform.rotation : 0;
          const cos = Math.cos(rotation) * scale;
          const sin = Math.sin(rotation) * scale;
          return [
            [cos, -sin, 0, transform.x],
            [sin, cos, 0, transform.y],
            [0, 0, 1, 0],
            [0, 0, 0, 1],
          ];
        };

        const referenceMatrix =
          stabilizationReference.matrix ?? buildScalarTransformMatrix(stabilizationReference);
        const currentMatrix =
          currentTransform.matrix ?? buildScalarTransformMatrix(currentTransform);
        const currentInverseMatrix = invertRotoTrackingMatrix4(currentMatrix);
        if (!currentInverseMatrix) {
          return null;
        }

        // Reduce the tracking composite difference to requested components
        // (translation, rotation, scale, affine, perspective).
        let result = reduceRotoTrackingMatrix4ToComponents(
          multiplyRotoTrackingMatrix4(referenceMatrix, currentInverseMatrix),
          stabilizationConfig,
        );

        // Handle auxiliary translation separately (full scope keyframe delta).
        // Left-multiply so it acts in screen space (like a viewport pan)
        // without disturbing the perspective row of the reduced matrix.
        const refAux = stabilizationReference.auxiliaryTranslation;
        const curAux = currentTransform.auxiliaryTranslation;
        if (refAux || curAux) {
          const identity = [
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 0],
            [0, 0, 0, 1],
          ];
          const refAuxMatrix = refAux ?? identity;
          const curAuxMatrix = curAux ?? identity;
          const curAuxInverse = invertRotoTrackingMatrix4(curAuxMatrix);
          if (curAuxInverse) {
            const auxDiff = multiplyRotoTrackingMatrix4(refAuxMatrix, curAuxInverse);
            result = multiplyRotoTrackingMatrix4(auxDiff, result);
          }
        }

        return result;
      }
    }
    return null;
  }, [
    isStabilized,
    stabilizationReference,
    stabilizationReferenceFrame,
    stabilizationConfig,
    selectedNode,
    visualFrame,
    selectedRotoLayerIds,
    selectedRotoPathIds,
  ]);

  const stabilizationInverseMatrix = useMemo(
    () => (stabilizationMatrix ? invertRotoTrackingMatrix4(stabilizationMatrix) : null),
    [stabilizationMatrix],
  );

  const stabilizedSceneStyle = useMemo<React.CSSProperties>(
    () =>
      sceneNode
        ? {
            position: 'absolute',
            inset: 0,
            transformOrigin: `${sceneNode.width / 2}px ${sceneNode.height / 2}px`,
            transform: stabilizationMatrix
              ? formatRotoTrackingMatrix4AsCssMatrix3d(stabilizationMatrix)
              : undefined,
            imageRendering: viewportInterpolation === 'nearest' ? 'pixelated' : 'auto',
          }
        : { display: 'none' },
    [sceneNode, stabilizationMatrix, viewportInterpolation],
  );

  const viewportTransformRef = useRef({
    pan,
    zoom,
    sceneNode,
    stabilizationInverseMatrix,
  });
  useLayoutEffect(() => {
    viewportTransformRef.current = {
      pan,
      zoom,
      sceneNode,
      stabilizationInverseMatrix,
    };
  }, [pan, zoom, sceneNode, stabilizationInverseMatrix]);

  const viewportToSceneCentered = useCallback((viewportPos: { x: number; y: number }) => {
    const {
      pan: currentPan,
      zoom: currentZoom,
      sceneNode: currentSceneNode,
      stabilizationInverseMatrix: currentStabilizationInverseMatrix,
    } = viewportTransformRef.current;
    if (!viewportRef.current || !currentSceneNode) return { x: 0, y: 0 };
    const rect = viewportRef.current.getBoundingClientRect();

    const scenePoint = {
      x: (viewportPos.x - (rect.width / 2 + currentPan.x)) / currentZoom,
      y: (viewportPos.y - (rect.height / 2 - currentPan.y)) / currentZoom,
    };

    return currentStabilizationInverseMatrix
      ? applyRotoTrackingMatrix4ToPoint(currentStabilizationInverseMatrix, scenePoint)
      : scenePoint;
  }, []);

  // --- Interaction hooks ---
  const warpInteraction = useWarpInteraction({
    selectedNode,
    sceneNode,
    activeViewportTool,
    zoom,
    visualFrame,
    nodes,
    selectedNodeId,
    updateNode,
    setActiveViewportTool,
    pushHistory,
  });

  const bokehInteraction = useBokehInteraction({
    selectedNode,
    sceneNode,
    activeViewportTool,
    pixelInfo,
    setKeyframe,
  });

  const paintInteraction = usePaintInteraction({
    nodes,
    selectedNode,
    selectedNodeId,
    selectedPaintLayerIds,
    selectedPaintStrokeIds,
    setSelectedPaintStrokeIds,
    activeViewportTool,
    sceneNode,
    frame: visualFrame,
    zoom,
    paintBrush,
    viewerChannels: viewerSettings.channels,
    nudgeRadius,
    updateNode,
    pushHistory,
    setPreferences,
  });

  const paintTexturesRef = useViewportPaintTextures({
    nodes: viewportNodes,
    currentFrame: visualFrame,
    sceneNode,
    livePreview: paintInteraction.livePreview,
    bumpMediaUpdate: bumpMediaUpdateTrigger,
  });

  const rotoInteraction = useRotoInteraction({
    selectedNode,
    selectedNodeId,
    nodes,
    selectedRotoLayerIds,
    selectedRotoPathIds,
    selectedRotoPointRefs,
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
    viewportRef,
    viewportToSceneCentered,
    updateNode,
    pushHistory,
    setSelectedRotoPathIds,
    setSelectedRotoSelection,
    setActiveViewportTool,
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

  const isInteractiveRotoPreviewActive =
    selectedNode?.type === NodeType.ROTO && rotoInteraction.isEditingRotoPaths;
  const freezeRotoMaskWhileEditing =
    isInteractiveRotoPreviewActive &&
    viewerSettings.channels !== 'A' &&
    !viewerSettings.alphaOverlay;

  const rotoMaskTexturesRef = useViewportRotoMasks({
    nodes: viewportNodes,
    sceneNode,
    currentFrame: visualFrame,
    motionBlurPreviewBackend: rotoMotionBlurPreviewBackend,
    interactiveMotionBlurPreviewEnabled: rotoMotionBlurInteractivePreviewEnabled,
    interactiveMotionBlurPreviewActive: isInteractiveRotoPreviewActive,
    interactiveMotionBlurPreviewSamples: rotoMotionBlurInteractivePreviewSamples,
    rotoPointWeightMode,
    suspendMaskUpdatesWhileEditing: freezeRotoMaskWhileEditing,
    bumpMediaUpdate: bumpMediaUpdateTrigger,
  });

  const handleRendererDispose = useCallback(() => {
    threeStuff.materials.forEach((mat) => mat?.dispose());
    threeStuff.renderTargets.forEach((rt) => rt?.dispose());
    textureCacheRef.current.clear();
    textTexturesRef.current.forEach((entry) => entry?.texture?.dispose());
    rotoMaskTexturesRef.current.forEach((entry) => {
      if (entry?.dispose) {
        entry.dispose();
      } else {
        entry?.texture?.dispose();
      }
    });

    if (threeStuff.quad) {
      threeStuff.scene.remove(threeStuff.quad);
      threeStuff.quad.geometry.dispose();
      threeStuff.quad = null;
    }
  }, [rotoMaskTexturesRef, textTexturesRef, textureCacheRef, threeStuff]);

  const gl = useViewportRenderer(canvasRef, viewportSize, handleRendererDispose);

  const { finalCompBufferRef } = useViewportRenderLoop({
    gl,
    canvasRef,
    nodes: viewportNodes,
    sceneNode,
    visualFrame,
    viewerSettings,
    alphaOverlayStyle,
    hasRenderableNodes: hasRenderableOutput,
    mediaUpdateTrigger,
    threeStuff,
    textureCacheRef,
    textTexturesRef,
    paintTexturesRef,
    rotoMaskTexturesRef,
    freezeImageWhileEditing: freezeRotoMaskWhileEditing,
    deferProjectThumbnailCapture: isFrameScrubbing || isInteractiveRotoPreviewActive,
    signalFrameRendered,
    setProjectThumbnail,
  });

  const minimapPreviewRefreshToken = useMemo(
    () => ({
      alphaOverlayStyle,
      hasRenderableOutput,
      mediaUpdateTrigger,
      nodes: viewportNodes,
      viewerSettings,
      visualFrame,
      viewportInterpolation,
    }),
    [
      alphaOverlayStyle,
      hasRenderableOutput,
      mediaUpdateTrigger,
      viewportNodes,
      viewerSettings,
      visualFrame,
      viewportInterpolation,
    ],
  );

  const showInteractionOverlays =
    rotoInteraction.shouldForceOverlays ||
    warpInteraction.shouldForceOverlays ||
    paintInteraction.shouldForceOverlays;
  const showOverlays = viewerSettings.showOverlays || showInteractionOverlays;
  const showRotoSelectOverlayWhenHidden =
    !showOverlays && selectedNode?.type === NodeType.ROTO && activeViewportTool === 'select';
  const showCursorOverlayWhenHidden =
    !showOverlays &&
    ((selectedNode?.type === NodeType.ROTO &&
      (activeViewportTool === 'nudge' || rotoInteraction.isAdjustingRadius)) ||
      (selectedNode?.type === NodeType.PAINT &&
        (activeViewportTool === 'brush' ||
          activeViewportTool === 'erase' ||
          activeViewportTool === 'clone')));
  const shouldRenderOverlaySvg =
    showOverlays || showCursorOverlayWhenHidden || showRotoSelectOverlayWhenHidden;

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
    sceneNode,
    zoom,
    pan,
    targetZoom,
    targetPan,
    viewportSize,
    viewportRef,
    projectId,
    setZoom,
    setPan,
    setAnimationTarget,
  });

  const activeViewportToolRef = useRef(activeViewportTool);
  useEffect(() => {
    const previousTool = activeViewportToolRef.current;
    activeViewportToolRef.current = activeViewportTool;
    rotoInteraction.cleanupOnToolChange(previousTool);
    warpInteraction.cleanupOnToolChange(previousTool);
    paintInteraction.cleanupOnToolChange(previousTool);
  });

  const runtimeCommands = useMemo<HotkeyCommand[]>(
    () => [
      {
        id: 'viewport.commitRotoRefinement.runtime',
        run: () => {
          if (!rotoRefinement) {
            return false;
          }
          commitRotoRefinement();
          return true;
        },
      },
      {
        id: 'viewport.deleteNudgeSelection.runtime',
        run: () => rotoInteraction.deletePointsInNudgeArea(),
      },
    ],
    [commitRotoRefinement, rotoInteraction, rotoRefinement],
  );

  const runtimeBindings = useMemo<HotkeyBinding[]>(
    () => [
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
    ],
    [rotoRefinement],
  );

  const rotoClipboardHotkeys = useRotoItemsClipboard({
    node: selectedNode?.type === NodeType.ROTO ? (selectedNode as RotoNode) : null,
    selectedLayerIds: selectedRotoLayerIds,
    selectedPathIds: selectedRotoPathIds,
    selectedPointRefs: selectedRotoPointRefs,
    updateNode,
    setSelectedRotoSelection,
  });
  const paintClipboardHotkeys = usePaintItemsClipboard({
    node: selectedNode?.type === NodeType.PAINT ? (selectedNode as PaintNode) : null,
    selectedLayerIds: selectedPaintLayerIds,
    selectedStrokeIds: selectedPaintStrokeIds,
    updateNode,
    setSelectedPaintLayerIds,
    setSelectedPaintStrokeIds,
  });
  const viewportClipboardHotkeys = useMemo(() => {
    if (selectedNode?.type === NodeType.ROTO) {
      return rotoClipboardHotkeys;
    }

    if (selectedNode?.type === NodeType.PAINT) {
      return paintClipboardHotkeys;
    }

    return {
      onCopy: () => false,
      onCut: () => false,
      onPaste: () => false,
    };
  }, [paintClipboardHotkeys, rotoClipboardHotkeys, selectedNode?.type]);
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

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const mousePos = getViewportMousePos(e.clientX, e.clientY);
    if (!mousePos) return;
    const scenePos = viewportToSceneCentered(mousePos);

    if (isLoading) return;
    if (rotoRefinement) return;

    // Delegate to interaction hooks (return true = consumed)
    if (paintInteraction.handleMouseDown(e, mousePos, scenePos)) return;
    if (rotoInteraction.handleMouseDown(e, mousePos, scenePos)) return;
    if (bokehInteraction.handleMouseDown(e, scenePos)) return;
    if (warpInteraction.handleMouseDown(e, mousePos, scenePos)) return;

    // Middle Mouse Button Logic (common viewport behaviour)
    if (e.button === 1 && sceneNode) {
      e.preventDefault();

      if (e.ctrlKey) {
        startScrub(e.clientX);
        return;
      }

      startPan(e);
      return;
    }
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

  const readPixelColor = useCallback(
    (
      renderTarget: THREE.WebGLRenderTarget,
      x: number,
      y: number,
    ): [number, number, number, number] => {
      if (!gl) return [0, 0, 0, 0];
      const textureType = renderTarget.texture.type;

      if (textureType === THREE.FloatType) {
        const buffer = pixelReadBuffer32Ref.current;
        gl.readRenderTargetPixels(renderTarget, x, y, 1, 1, buffer);
        return [buffer[0], buffer[1], buffer[2], buffer[3]];
      }

      if (textureType === THREE.HalfFloatType) {
        const buffer = pixelReadBuffer16Ref.current;
        gl.readRenderTargetPixels(renderTarget, x, y, 1, 1, buffer);
        return [
          THREE.DataUtils.fromHalfFloat(buffer[0]),
          THREE.DataUtils.fromHalfFloat(buffer[1]),
          THREE.DataUtils.fromHalfFloat(buffer[2]),
          THREE.DataUtils.fromHalfFloat(buffer[3]),
        ];
      }

      const buffer = pixelReadBuffer8Ref.current;
      gl.readRenderTargetPixels(renderTarget, x, y, 1, 1, buffer);
      return [buffer[0] / 255, buffer[1] / 255, buffer[2] / 255, buffer[3] / 255];
    },
    [gl],
  );

  const handleMouseMove = useCallback(
    (e: ViewportMouseEvent) => {
      const nativeEvent = getNativeMouseEvent(e);
      if (lastHandledMouseEventRef.current === nativeEvent) return;
      lastHandledMouseEventRef.current = nativeEvent;

      if (isScrubbing) {
        return;
      }

      if (isMousePanning) {
        return;
      }

      const mousePos = getViewportMousePos(e.clientX, e.clientY);
      if (!mousePos) return;
      const scenePos = viewportToSceneCentered(mousePos);
      setMouseScenePos(scenePos);

      if (isLoading) return;

      // Delegate to interaction hooks (exclusive handlers return true)
      if (paintInteraction.handleMouseMove(e, mousePos, scenePos)) return;
      if (rotoInteraction.handleMouseMove(e, mousePos, scenePos)) return;
      if (warpInteraction.handleMouseMove(e, mousePos, scenePos)) return;

      // Pixel info reading (always runs when no exclusive handler consumed the event)
      if (
        !gl ||
        !viewportRef.current ||
        !sceneNode ||
        !finalCompBufferRef.current ||
        !hasRenderableOutput
      ) {
        if (pixelInfo) setPixelInfo(null);
        return;
      }
      const sceneX = Math.floor(scenePos.x + sceneNode.width / 2),
        sceneY = Math.floor(scenePos.y + sceneNode.height / 2);
      if (sceneX >= 0 && sceneX < sceneNode.width && sceneY >= 0 && sceneY < sceneNode.height) {
        const color = readPixelColor(
          finalCompBufferRef.current,
          sceneX,
          sceneNode.height - 1 - sceneY,
        );
        setPixelInfo({
          x: sceneX,
          y: sceneY,
          color,
        });
      } else setPixelInfo(null);
    },
    [
      finalCompBufferRef,
      getNativeMouseEvent,
      getViewportMousePos,
      gl,
      hasRenderableOutput,
      isLoading,
      isMousePanning,
      isScrubbing,
      paintInteraction,
      pixelInfo,
      readPixelColor,
      rotoInteraction,
      sceneNode,
      viewportToSceneCentered,
      warpInteraction,
    ],
  );

  const handleMouseUp = useCallback(
    (e: ViewportMouseEvent) => {
      const nativeEvent = getNativeMouseEvent(e);
      if (lastHandledMouseEventRef.current === nativeEvent) return;
      lastHandledMouseEventRef.current = nativeEvent;

      if (isLoading) return;
      paintInteraction.handleMouseUp();
      rotoInteraction.handleMouseUp(e);
      warpInteraction.handleMouseUp();
    },
    [getNativeMouseEvent, isLoading, paintInteraction, rotoInteraction, warpInteraction],
  );

  const hasGlobalMouseCapture = Boolean(
    warpInteraction.dragPinState ||
    paintInteraction.isPainting ||
    paintInteraction.isSettingCloneSource ||
    paintInteraction.isAdjustingBrushSize ||
    paintInteraction.nudgeDragState ||
    paintInteraction.isAdjustingNudgeRadius ||
    rotoInteraction.dragPointState ||
    rotoInteraction.transformDragState ||
    rotoInteraction.nudgeDragState ||
    rotoInteraction.pointWeightDragState ||
    rotoInteraction.insertedPointDragState ||
    rotoInteraction.marqueeState ||
    rotoInteraction.drawingState ||
    rotoInteraction.freehandPoints ||
    rotoInteraction.dragNewPointIndex !== null ||
    rotoInteraction.isAdjustingRadius,
  );

  useEffect(() => {
    if (!hasGlobalMouseCapture) return;

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
  }, [handleMouseMove, handleMouseUp, hasGlobalMouseCapture]);

  useEffect(() => {
    if (!isScrubbing) return;
    setPixelInfo(null);
    setMouseScenePos(null);
  }, [isScrubbing]);

  useEffect(() => {
    if (!isMousePanning) return;
    setPixelInfo(null);
    setMouseScenePos(null);
  }, [isMousePanning]);

  const handleMouseLeave = () => {
    if (hasGlobalMouseCapture) return;
    setPixelInfo(null);
    setMouseScenePos(null);
    paintInteraction.handleMouseLeave();
    rotoInteraction.handleMouseLeave();
    warpInteraction.handleMouseLeave();
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

  const dataWindowRect = useMemo(() => {
    if (!sceneNode || !selectedNode || !nodeFlags(selectedNode.type).showDataWindow) {
      return null;
    }
    if (
      !('transform' in selectedNode) ||
      typeof selectedNode.width !== 'number' ||
      typeof selectedNode.height !== 'number'
    ) {
      return null;
    }
    const mediaNode = selectedNode;
    const scaleAtFrame = getValueAtFrame(mediaNode.transform.scale, visualFrame);
    const xAtFrame = getValueAtFrame(mediaNode.transform.x, visualFrame);
    const yAtFrame = getValueAtFrame(mediaNode.transform.y, visualFrame);
    const width = mediaNode.width * scaleAtFrame;
    const height = mediaNode.height * scaleAtFrame;
    const x = sceneNode.width / 2 + xAtFrame - width / 2;
    const y = sceneNode.height / 2 - yAtFrame - height / 2;
    return {
      x,
      y,
      width,
      height,
      nativeWidth: mediaNode.width as number,
      nativeHeight: mediaNode.height as number,
    };
  }, [selectedNode, sceneNode, visualFrame]);

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

  const cursorClass = useMemo(() => {
    if (isLoading) return 'cursor-wait';
    if (isScrubbing) return 'cursor-ew-resize';
    if (rotoInteraction.transformDragState) return 'cursor-grabbing';
    if (rotoInteraction.hoveredTransformHandle)
      return getTransformHandleCursor(
        rotoInteraction.hoveredTransformHandle,
        affineModifierPressed,
        altPressed,
      );
    if (paintInteraction.isAdjustingBrushSize) return 'cursor-none';
    if (
      rotoInteraction.nudgeDragState ||
      warpInteraction.dragPinState ||
      rotoInteraction.insertedPointDragState
    )
      return 'cursor-grabbing';
    if (rotoInteraction.dragPointState) return 'cursor-move';
    if (
      rotoInteraction.isHoveringClosePoint ||
      warpInteraction.hoveredPinId ||
      rotoInteraction.hoveredSegment
    )
      return 'cursor-pointer';
    if (
      activeViewportTool === 'rectangle' ||
      activeViewportTool === 'bspline' ||
      activeViewportTool === 'freehand' ||
      activeViewportTool === 'brush' ||
      activeViewportTool === 'erase' ||
      activeViewportTool === 'clone' ||
      activeViewportTool === 'add_pin' ||
      activeViewportTool === 'bokeh_pick'
    )
      return 'cursor-crosshair';
    if (activeViewportTool === 'nudge' || rotoInteraction.isAdjustingRadius) return 'cursor-none';
    return rotoInteraction.isRotoSelectActive ? 'cursor-default' : '';
  }, [
    rotoInteraction.isHoveringClosePoint,
    activeViewportTool,
    rotoInteraction.isRotoSelectActive,
    rotoInteraction.dragPointState,
    rotoInteraction.nudgeDragState,
    rotoInteraction.isAdjustingRadius,
    warpInteraction.dragPinState,
    warpInteraction.hoveredPinId,
    rotoInteraction.hoveredSegment,
    rotoInteraction.insertedPointDragState,
    isLoading,
    isScrubbing,
    rotoInteraction.transformDragState,
    rotoInteraction.hoveredTransformHandle,
    paintInteraction.isAdjustingBrushSize,
    affineModifierPressed,
  ]);

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    rotoInteraction.handleContextMenu(e);
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
    selectedRotoPathIds,
    visualFrame,
    maxFrames,
    rotoPointWeightMode,
    stabilizationMatrix,
  });

  const rotoNudgeOverlayState = useMemo<NudgeOverlayState>(
    () => ({
      activeViewportTool,
      altPressed,
      isAdjustingRadius: rotoInteraction.isAdjustingRadius,
      nudgeDragState: rotoInteraction.nudgeDragState,
      radiusAdjustCenter: rotoInteraction.radiusAdjustStartRef.current?.center ?? null,
      radiusAdjustInitialRadius:
        rotoInteraction.radiusAdjustStartRef.current?.initialRadius ?? null,
      mouseScenePos,
      nudgeRadius,
      nudgePreviewPoints: rotoInteraction.nudgePreviewPoints,
    }),
    [
      activeViewportTool,
      altPressed,
      mouseScenePos,
      nudgeRadius,
      rotoInteraction.isAdjustingRadius,
      rotoInteraction.nudgeDragState,
      rotoInteraction.nudgePreviewPoints,
      rotoInteraction.radiusAdjustStartRef,
    ],
  );

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
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {viewerSettings.alphaMode === 'TRANSPARENT' && (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(45deg, #404040 25%, transparent 25%), linear-gradient(-45deg, #404040 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #404040 75%), linear-gradient(-45deg, transparent 75%, #404040 75%)',
              backgroundSize: '20px 20px',
              backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
            }}
          />
        )}
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
                  {sceneNode.width > 150 && (
                    <div
                      className="absolute top-0 left-0 bg-cyan-900/80 text-cyan-200 text-[10px] px-1.5 py-0.5 font-mono"
                      style={{
                        transform: `translate(${-1 / zoom}px, -100%) scale(${1 / zoom})`,
                        transformOrigin: 'bottom left',
                      }}
                    >
                      Display Window ({sceneNode.width}x{sceneNode.height})
                    </div>
                  )}
                  {selectedNode && dataWindowRect && dataWindowRect.width > 150 && (
                    <div
                      className="absolute bg-amber-900/80 text-amber-200 text-[10px] px-1.5 py-0.5 font-mono"
                      style={{
                        left: dataWindowRect.x,
                        top: dataWindowRect.y,
                        transform: `translate(${-1 / zoom}px, -100%) scale(${1 / zoom})`,
                        transformOrigin: 'bottom left',
                      }}
                    >
                      Data Window ({dataWindowRect.nativeWidth}x{dataWindowRect.nativeHeight})
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
            </div>
            {shouldRenderOverlaySvg && (
              <svg
                className={`absolute top-0 left-0 w-full h-full pointer-events-none`}
                viewBox={`0 0 ${sceneNode.width} ${sceneNode.height}`}
                style={{ overflow: 'visible' }}
              >
                {showOverlays && (
                  <defs>
                    {rotoInteraction.bsplineDrawingState?.previewSegment &&
                      (() => {
                        const sStart = stabilizePoint(
                          rotoInteraction.bsplineDrawingState.previewSegment.start,
                          stabilizationMatrix,
                        );
                        const sEnd = stabilizePoint(
                          rotoInteraction.bsplineDrawingState.previewSegment.end,
                          stabilizationMatrix,
                        );
                        return (
                          <linearGradient
                            id="roto-preview-gradient"
                            gradientUnits="userSpaceOnUse"
                            x1={sStart.x}
                            y1={sStart.y}
                            x2={sEnd.x}
                            y2={sEnd.y}
                          >
                            <stop stopColor="yellow" stopOpacity="1" />
                            <stop offset="100%" stopColor="yellow" stopOpacity="0.2" />
                          </linearGradient>
                        );
                      })()}
                  </defs>
                )}
                {/* Display Window border (cyan) */}
                {viewerSettings.showOverlays &&
                  (() => {
                    const corners = stabilizeBboxCorners(0, 0, sceneNode.width, sceneNode.height);
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
                <g transform={`translate(${sceneNode.width / 2}, ${sceneNode.height / 2})`}>
                  {showOverlays && selectedNode?.type === NodeType.WARP && (
                    <WarpOverlay
                      node={selectedNode as WarpNode}
                      sceneWidth={sceneNode.width}
                      sceneHeight={sceneNode.height}
                      frame={visualFrame}
                      zoom={zoom}
                      hoveredPinId={warpInteraction.hoveredPinId}
                      dragPinId={warpInteraction.dragPinState?.pinId ?? null}
                      onPinHover={warpInteraction.setHoveredPinId}
                      stabilizationMatrix={stabilizationMatrix}
                    />
                  )}
                  {selectedNode?.type === NodeType.ROTO && (
                    <RotoOverlay
                      node={selectedNode as RotoNode}
                      frame={visualFrame}
                      zoom={zoom}
                      selectedRotoPathIds={selectedRotoPathIds}
                      selectedRotoPointRefs={selectedRotoPointRefs}
                      setSelectedRotoPathIds={setSelectedRotoPathIds}
                      isRotoSelectActive={rotoInteraction.isRotoSelectActive}
                      activeViewportTool={activeViewportTool}
                      altPressed={altPressed}
                      nudge={rotoNudgeOverlayState}
                      rotoTransformSelection={rotoInteraction.rotoTransformSelection}
                      transformIsDegenerate={rotoInteraction.transformIsDegenerate}
                      transformMoveHandleRadius={rotoInteraction.transformMoveHandleRadius}
                      transformRotateHitRadius={rotoInteraction.transformRotateHitRadius}
                      transformHandleSize={rotoInteraction.transformHandleSize}
                      transformHandleHitSize={rotoInteraction.transformHandleHitSize}
                      transformHandlePositions={rotoInteraction.transformHandlePositions}
                      transformRotateHandlePoint={rotoInteraction.transformRotateHandlePoint}
                      transformInteractionLabel={rotoInteraction.transformInteractionLabel}
                      activeTransformHandle={rotoInteraction.activeTransformHandle}
                      hoveredTransformHandle={rotoInteraction.hoveredTransformHandle}
                      affineModifierPressed={affineModifierPressed}
                      isMoveTransformActive={rotoInteraction.isMoveTransformActive}
                      isMoveTransformHovered={rotoInteraction.isMoveTransformHovered}
                      isRotateTransformActive={rotoInteraction.isRotateTransformActive}
                      isRotateTransformHovered={rotoInteraction.isRotateTransformHovered}
                      beginRotoTransformDrag={rotoInteraction.beginRotoTransformDrag}
                      setHoveredTransformHandle={rotoInteraction.setHoveredTransformHandle}
                      hoveredRotoPathId={rotoInteraction.hoveredRotoPathId}
                      setHoveredRotoPathId={rotoInteraction.setHoveredRotoPathId}
                      dragPointState={rotoInteraction.dragPointState}
                      hoveredPointInfo={rotoInteraction.hoveredPointInfo}
                      handlePointMouseDown={rotoInteraction.handlePointMouseDown}
                      beginPointWeightDrag={rotoInteraction.beginPointWeightDrag}
                      setSelectedPointWeightMode={rotoInteraction.setSelectedPointWeightMode}
                      setSelectedPointType={rotoInteraction.setSelectedPointType}
                      setHoveredPointInfo={rotoInteraction.setHoveredPointInfo}
                      pointWeightDragState={rotoInteraction.pointWeightDragState}
                      pointWeightControlState={rotoInteraction.pointWeightControlState}
                      rotoPointWeightMode={rotoPointWeightMode}
                      temporalController={rotoInteraction.temporalController}
                      onTemporalControllerChange={rotoInteraction.setTemporalControllerValue}
                      onTemporalControllerCommit={rotoInteraction.commitTemporalController}
                      motionCueTargetPathIdSet={motionCueTargetPathIdSet}
                      rotoMotionCueEnabled={rotoMotionCueEnabled}
                      rotoMotionCueMode={rotoMotionCueMode}
                      gradientTrailsByPath={gradientTrailsByPath}
                      speedHeatSegmentsByPath={speedHeatSegmentsByPath}
                      motionBlurCuePathsByPath={motionBlurCuePathsByPath}
                      hoveredSegment={rotoInteraction.hoveredSegment}
                      rotoRefinement={rotoRefinement}
                      refinementSimplifiedPoints={refinementSimplifiedPoints}
                      isDrawing={isDrawing}
                      drawingRotoPath={drawingRotoPath}
                      bsplineDrawingState={rotoInteraction.bsplineDrawingState}
                      drawingState={rotoInteraction.drawingState}
                      freehandPoints={rotoInteraction.freehandPoints}
                      isHoveringClosePoint={rotoInteraction.isHoveringClosePoint}
                      marqueeState={rotoInteraction.marqueeState}
                      activeTrackingPoints={activeTrackingPoints}
                      cursorOnly={!showOverlays}
                      stabilizationMatrix={stabilizationMatrix}
                    />
                  )}
                  {selectedNode?.type === NodeType.PAINT && (
                    <PaintOverlay
                      node={selectedNode as PaintNode}
                      brushSize={paintBrush.size}
                      zoom={zoom}
                      activeTool={activeViewportTool}
                      cursorScenePos={paintInteraction.cursorScenePos}
                      strokePoints={paintInteraction.strokePoints}
                      cloneSourcePreviewPos={paintInteraction.cloneSourcePreviewPos}
                      isSettingCloneSource={paintInteraction.isSettingCloneSource}
                      isAdjustingBrushSize={paintInteraction.isAdjustingBrushSize}
                      brushAdjustCenter={
                        paintInteraction.brushAdjustStartRef.current?.center ?? null
                      }
                      brushAdjustInitialSize={
                        paintInteraction.brushAdjustStartRef.current?.initialSize ?? null
                      }
                      cursorOnly={!showOverlays}
                      showStrokePaths={paintStrokePathsVisible}
                      strokePathsMode={paintStrokePathsMode}
                      selectedPaintLayerIds={selectedPaintLayerIds as string[]}
                      selectedPaintStrokeIds={selectedPaintStrokeIds as string[]}
                      onStrokeSelect={(strokeId, shiftKey) => {
                        if (shiftKey) {
                          const ids = selectedPaintStrokeIds as string[];
                          setSelectedPaintStrokeIds(
                            ids.includes(strokeId)
                              ? ids.filter((id) => id !== strokeId)
                              : [...ids, strokeId],
                          );
                        } else {
                          setSelectedPaintStrokeIds([strokeId]);
                        }
                      }}
                      frame={visualFrame}
                      nudgeRadius={nudgeRadius}
                      nudgeDragState={paintInteraction.nudgeDragState}
                      nudgePreviewPoints={paintInteraction.nudgePreviewPoints}
                      isAdjustingNudgeRadius={paintInteraction.isAdjustingNudgeRadius}
                      nudgeRadiusAdjustCenter={
                        paintInteraction.nudgeRadiusAdjustStartRef.current?.center ?? null
                      }
                      nudgeRadiusAdjustInitialRadius={
                        paintInteraction.nudgeRadiusAdjustStartRef.current?.initialRadius ?? null
                      }
                      mouseScenePos={mouseScenePos}
                      stabilizationMatrix={stabilizationMatrix}
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
        {hasRenderableOutput && <ViewportSettingsBar />}
        {sceneNode && <ViewportControls visible={!isFit} onFit={fitToView} zoomValue={zoom} />}
        {!isFit && sceneNode && hasRenderableOutput && (
          <Minimap
            sourceCanvas={gl?.domElement ?? canvasRef.current}
            viewportSize={viewportSize}
            sceneSize={{ width: sceneNode.width, height: sceneNode.height }}
            previewRefreshToken={minimapPreviewRefreshToken}
          />
        )}
        {sceneNode && <PixelInspector info={pixelInfo} bitDepth={sceneNode.bitDepth} />}
      </div>
      {isDragging && (
        <div className="absolute inset-0 bg-black/50 z-20 flex items-center justify-center pointer-events-none">
          <p className="text-white text-lg font-semibold">Drop media to open</p>
        </div>
      )}
    </div>
  );
};

export default Viewport;
