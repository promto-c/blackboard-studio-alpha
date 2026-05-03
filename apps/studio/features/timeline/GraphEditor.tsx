import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { useSelectedEditorNode } from '@/hooks/useEditorNodes';
import { getAnimatableProperties } from '@/effects/effectAnimation';
import { Keyframe } from '@blackboard/types';
import { getSortedKeyframes, getSegmentTangents } from '@blackboard/renderer';

// --- TYPES ---
type DragInfo = {
  type: 'keyframe' | 'inTangent' | 'outTangent' | 'pan';
  keyIndex?: number;
  startX: number;
  startY: number;
  originalView: { panX: number; panY: number };
  originalKeyframe?: Keyframe;
};

// --- CONSTANTS ---
const KEYFRAME_SELECTED_COLOR = '#FACC15'; // yellow-400
const KEYFRAME_COLOR = '#ffffff';
const TANGENT_COLOR = '#A3A3A3';
const CURVE_COLOR = 'rgb(var(--color-primary-500))';
const GRID_MINOR = 'rgba(255, 255, 255, 0.03)';

interface GraphEditorProps {
  width: number;
  height: number;
  view: { panX: number; panY: number; zoomX: number; zoomY: number };
  setView: React.Dispatch<
    React.SetStateAction<{ panX: number; panY: number; zoomX: number; zoomY: number }>
  >;
  activePropertyPath: string | null;
}

const GraphEditor: React.FC<GraphEditorProps> = ({
  width,
  height,
  view,
  setView,
  activePropertyPath,
}) => {
  const maxFrames = useEditorSelector((s) => s.maxFrames);
  const currentFrame = useEditorSelector((s) => s.currentFrame);
  const { updateKeyframe, setKeyframe } = useEditorActions();
  const selectedNode = useSelectedEditorNode();
  const animatableProps = useMemo(() => getAnimatableProperties(selectedNode), [selectedNode]);

  const [dragInfo, setDragInfo] = useState<DragInfo | null>(null);
  const [selectedKeyframeIndex, setSelectedKeyframeIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeProperty = useMemo(
    () => animatableProps.find((p) => p.path === activePropertyPath),
    [animatableProps, activePropertyPath],
  );

  const keyframes = useMemo((): Keyframe[] => {
    if (!activeProperty) return [];
    if (typeof activeProperty.prop === 'number') {
      return [
        { frame: -1000, value: activeProperty.prop },
        { frame: maxFrames + 1000, value: activeProperty.prop },
      ] as Keyframe[];
    }
    return getSortedKeyframes(activeProperty.prop);
  }, [activeProperty, maxFrames]);

  // --- Coordinate Transforms ---
  const dataToView = useCallback(
    (data: { frame: number; value: number }) => {
      return {
        x: data.frame * view.zoomX + view.panX,
        y: -data.value * view.zoomY + view.panY,
      };
    },
    [view],
  );

  const viewToData = useCallback(
    (viewCoords: { x: number; y: number }) => {
      return {
        frame: (viewCoords.x - view.panX) / view.zoomX,
        value: (viewCoords.y - view.panY) / -view.zoomY,
      };
    },
    [view],
  );

  // --- Event Handlers ---
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = containerRef.current!.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const beforeData = viewToData({ x: mouseX, y: mouseY });
      const zoomFactor = 1.1;

      const zoomXFactor = e.altKey ? 1 : e.deltaY < 0 ? zoomFactor : 1 / zoomFactor;
      const zoomYFactor = e.shiftKey ? 1 : e.deltaY < 0 ? zoomFactor : 1 / zoomFactor;

      const newZoomX = view.zoomX * zoomXFactor;
      const newZoomY = view.zoomY * zoomYFactor;

      const newPanX = mouseX - beforeData.frame * newZoomX;
      const newPanY = mouseY + beforeData.value * newZoomY;

      setView({ panX: newPanX, panY: newPanY, zoomX: newZoomX, zoomY: newZoomY });
    },
    [view, viewToData, setView],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGElement>, type: DragInfo['type'], keyIndex?: number) => {
      e.stopPropagation();
      if (e.button === 1) {
        setDragInfo({
          type: 'pan',
          startX: e.clientX,
          startY: e.clientY,
          originalView: view,
        });
        return;
      }
      if (e.button === 0) {
        if (type === 'keyframe' && keyIndex !== undefined) {
          setSelectedKeyframeIndex(keyIndex);
          setDragInfo({
            type: 'keyframe',
            keyIndex,
            startX: e.clientX,
            startY: e.clientY,
            originalView: view,
            originalKeyframe: keyframes[keyIndex],
          });
        } else if ((type === 'inTangent' || type === 'outTangent') && keyIndex !== undefined) {
          setDragInfo({
            type,
            keyIndex,
            startX: e.clientX,
            startY: e.clientY,
            originalView: view,
            originalKeyframe: keyframes[keyIndex],
          });
        }
      }
    },
    [view, keyframes],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!selectedNode || !activePropertyPath) return;
      const rect = containerRef.current!.getBoundingClientRect();
      const mousePos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const dataPos = viewToData(mousePos);

      setKeyframe(
        selectedNode.id,
        activePropertyPath,
        dataPos.value,
        true,
        Math.round(dataPos.frame),
        true,
      );
    },
    [viewToData, setKeyframe, selectedNode, activePropertyPath],
  );

  useEffect(() => {
    if (!dragInfo) return;
    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragInfo.startX;
      const dy = e.clientY - dragInfo.startY;

      if (dragInfo.type === 'pan') {
        setView((v) => ({
          ...v,
          panX: dragInfo.originalView.panX + dx,
          panY: dragInfo.originalView.panY + dy,
        }));
      }
    };
    const handleMouseUp = () => setDragInfo(null);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragInfo, setView]);

  const handleDrag = useCallback(
    (e: React.MouseEvent) => {
      if (
        !dragInfo ||
        dragInfo.type === 'pan' ||
        dragInfo.keyIndex === undefined ||
        !dragInfo.originalKeyframe ||
        !selectedNode ||
        !activePropertyPath
      )
        return;

      const mousePos = { x: e.clientX, y: e.clientY };
      const rect = containerRef.current!.getBoundingClientRect();
      const svgMousePos = { x: mousePos.x - rect.left, y: mousePos.y - rect.top };
      const dataPos = viewToData(svgMousePos);

      const updates: Partial<Keyframe> = {};
      const kf = keyframes[dragInfo.keyIndex];

      switch (dragInfo.type) {
        case 'keyframe':
          updates.frame = Math.round(dataPos.frame);
          updates.value = dataPos.value;
          break;
        case 'inTangent':
          updates.inTangent = {
            x: dataPos.frame - kf.frame,
            y: dataPos.value - kf.value,
          };
          break;
        case 'outTangent':
          updates.outTangent = {
            x: dataPos.frame - kf.frame,
            y: dataPos.value - kf.value,
          };
          break;
      }
      updateKeyframe(selectedNode.id, activePropertyPath, kf.frame, updates, false);
    },
    [dragInfo, viewToData, updateKeyframe, selectedNode, activePropertyPath, keyframes],
  );

  const handleMouseUp = useCallback(() => {
    if (
      dragInfo &&
      dragInfo.type !== 'pan' &&
      dragInfo.keyIndex !== undefined &&
      selectedNode &&
      activePropertyPath
    ) {
      const kf = keyframes[dragInfo.keyIndex];
      updateKeyframe(selectedNode.id, activePropertyPath, kf.frame, {}, true);
    }
    setDragInfo(null);
  }, [dragInfo, updateKeyframe, selectedNode, activePropertyPath, keyframes]);

  // --- Grid & Rendering ---
  const grid = useMemo(() => {
    const minData = viewToData({ x: 0, y: height });
    const maxData = viewToData({ x: width, y: 0 });

    const valueRange = maxData.value - minData.value;
    const valueStep = Math.pow(10, Math.floor(Math.log10(valueRange / 5)));
    const valueStart = Math.floor(minData.value / valueStep) * valueStep;

    const timeRange = maxData.frame - minData.frame;
    const timeStep = Math.pow(10, Math.floor(Math.log10(timeRange / 5)));
    const timeStart = Math.floor(minData.frame / timeStep) * timeStep;

    const horizontal = [];
    for (let v = valueStart; v < maxData.value; v += valueStep) {
      const y = dataToView({ frame: 0, value: v }).y;
      horizontal.push({ y, value: v });
    }

    const vertical = [];
    for (let t = timeStart; t < maxData.frame; t += timeStep) {
      const x = dataToView({ frame: t, value: 0 }).x;
      vertical.push({ x, value: t });
    }

    return { horizontal, vertical };
  }, [viewToData, dataToView, width, height]);

  const curvePath = useMemo(() => {
    if (keyframes.length < 2) return '';
    let path = '';
    for (let i = 0; i < keyframes.length - 1; i++) {
      const k1 = keyframes[i];
      const k2 = keyframes[i + 1];
      const { outTangent: outT, inTangent: inT } = getSegmentTangents(k1, k2);
      const p1 = dataToView({ frame: k1.frame, value: k1.value });
      const p2 = dataToView({ frame: k1.frame + outT.x, value: k1.value + outT.y });
      const p3 = dataToView({ frame: k2.frame + inT.x, value: k2.value + inT.y });
      const p4 = dataToView({ frame: k2.frame, value: k2.value });
      path += `${i === 0 ? 'M' : 'L'} ${p1.x} ${p1.y} C ${p2.x} ${p2.y}, ${p3.x} ${p3.y}, ${p4.x} ${p4.y}`;
    }
    return path;
  }, [keyframes, dataToView]);

  if (!selectedNode || !activeProperty)
    return (
      <div className="flex h-full items-center justify-center text-xs text-gray-500">
        Select a property to edit curves
      </div>
    );

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-gradient-to-b from-gray-900/35 to-black/30"
      onMouseMove={handleDrag}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
    >
      {/* Value Axis Labels (Overlay) */}
      <div className="absolute top-0 left-0 bottom-0 w-10 pointer-events-none overflow-hidden z-10">
        {grid.horizontal.map((line, i) => (
          <div
            key={i}
            className="absolute right-1 text-[9px] text-gray-500 font-mono"
            style={{ top: line.y - 6 }}
          >
            {line.value.toFixed(1)}
          </div>
        ))}
      </div>

      <svg
        width={width}
        height={height}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) handleMouseDown(e, 'pan');
        }}
        onDoubleClick={handleDoubleClick}
        className="cursor-crosshair"
      >
        <defs>
          <clipPath id="graphClip">
            <rect x={0} y={0} width={width} height={height} />
          </clipPath>
        </defs>
        <g clipPath="url(#graphClip)">
          {/* Grid Lines */}
          {grid.horizontal.map((h, i) => (
            <line
              key={`h${i}`}
              x1={0}
              y1={h.y}
              x2={width}
              y2={h.y}
              stroke={GRID_MINOR}
              strokeWidth={1}
            />
          ))}
          {grid.vertical.map((v, i) => (
            <line
              key={`v${i}`}
              x1={v.x}
              y1={0}
              x2={v.x}
              y2={height}
              stroke={GRID_MINOR}
              strokeWidth={1}
            />
          ))}
          {/* Playhead */}
          <line
            x1={dataToView({ frame: currentFrame, value: 0 }).x}
            y1={0}
            x2={dataToView({ frame: currentFrame, value: 0 }).x}
            y2={height}
            stroke="rgba(var(--color-primary-500))"
            strokeWidth={1}
            strokeDasharray="4 2"
          />

          {/* Curve */}
          <path d={curvePath} stroke={CURVE_COLOR} strokeWidth={2} fill="none" />

          {/* Keyframes */}
          {keyframes.map((kf, i) => {
            const pos = dataToView({ frame: kf.frame, value: kf.value });
            const isSelected = selectedKeyframeIndex === i;
            return (
              <g key={i}>
                {isSelected && (
                  <>
                    {(() => {
                      const prevKf = i > 0 ? keyframes[i - 1] : null;
                      const nextKf = i < keyframes.length - 1 ? keyframes[i + 1] : null;
                      const fallbackDiff = (() => {
                        if (prevKf && nextKf) return (nextKf.frame - prevKf.frame) / 3;
                        if (prevKf) return (kf.frame - prevKf.frame) / 3;
                        if (nextKf) return (nextKf.frame - kf.frame) / 3;
                        return 10;
                      })();
                      const inT = prevKf
                        ? getSegmentTangents(prevKf, kf).inTangent
                        : (kf.inTangent ?? { x: -fallbackDiff, y: 0 });
                      const outT = nextKf
                        ? getSegmentTangents(kf, nextKf).outTangent
                        : (kf.outTangent ?? { x: fallbackDiff, y: 0 });
                      const inPos = dataToView({
                        frame: kf.frame + inT.x,
                        value: kf.value + inT.y,
                      });
                      const outPos = dataToView({
                        frame: kf.frame + outT.x,
                        value: kf.value + outT.y,
                      });

                      return (
                        <>
                          <line
                            x1={pos.x}
                            y1={pos.y}
                            x2={inPos.x}
                            y2={inPos.y}
                            stroke={TANGENT_COLOR}
                            strokeWidth={1}
                          />
                          <rect
                            x={inPos.x - 2.5}
                            y={inPos.y - 2.5}
                            width={5}
                            height={5}
                            fill={TANGENT_COLOR}
                            className="cursor-move"
                            onMouseDown={(e) => handleMouseDown(e, 'inTangent', i)}
                          />
                          <line
                            x1={pos.x}
                            y1={pos.y}
                            x2={outPos.x}
                            y2={outPos.y}
                            stroke={TANGENT_COLOR}
                            strokeWidth={1}
                          />
                          <rect
                            x={outPos.x - 2.5}
                            y={outPos.y - 2.5}
                            width={5}
                            height={5}
                            fill={TANGENT_COLOR}
                            className="cursor-move"
                            onMouseDown={(e) => handleMouseDown(e, 'outTangent', i)}
                          />
                        </>
                      );
                    })()}
                  </>
                )}
                <rect
                  x={pos.x - 4}
                  y={pos.y - 4}
                  width={8}
                  height={8}
                  fill={isSelected ? KEYFRAME_SELECTED_COLOR : KEYFRAME_COLOR}
                  stroke={isSelected ? KEYFRAME_SELECTED_COLOR : 'none'}
                  className="cursor-move"
                  onMouseDown={(e) => handleMouseDown(e, 'keyframe', i)}
                  transform={`rotate(45 ${pos.x} ${pos.y})`}
                />
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
};

export default GraphEditor;
