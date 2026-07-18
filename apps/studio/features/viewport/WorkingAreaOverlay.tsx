import type { NormalizedRect, SceneNode } from '@blackboard/types';
import { getWorkingAreaCoverage, resolveWorkingAreaPixelRect } from './workingArea';

const HANDLE_SIZE = 8;

export function WorkingAreaOverlay({
  rect,
  scene,
  zoom,
  editable,
}: {
  rect: NormalizedRect;
  scene: Pick<SceneNode, 'width' | 'height'>;
  zoom: number;
  editable: boolean;
}) {
  const pixelRect = resolveWorkingAreaPixelRect({ enabled: true, rect }, scene);
  if (!pixelRect) return null;
  const coverage = getWorkingAreaCoverage(pixelRect, scene);
  const handleSize = HANDLE_SIZE / Math.max(zoom, 0.01);
  const strokeWidth = 1.25 / Math.max(zoom, 0.01);
  const handles = [
    [pixelRect.x, pixelRect.y],
    [pixelRect.x + pixelRect.width / 2, pixelRect.y],
    [pixelRect.x + pixelRect.width, pixelRect.y],
    [pixelRect.x + pixelRect.width, pixelRect.y + pixelRect.height / 2],
    [pixelRect.x + pixelRect.width, pixelRect.y + pixelRect.height],
    [pixelRect.x + pixelRect.width / 2, pixelRect.y + pixelRect.height],
    [pixelRect.x, pixelRect.y + pixelRect.height],
    [pixelRect.x, pixelRect.y + pixelRect.height / 2],
  ];

  return (
    <div className="pointer-events-none absolute inset-0 z-40" aria-hidden="true">
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        <path
          d={`M0 0H${scene.width}V${scene.height}H0Z M${pixelRect.x} ${pixelRect.y}H${pixelRect.x + pixelRect.width}V${pixelRect.y + pixelRect.height}H${pixelRect.x}Z`}
          fill="rgba(2, 6, 23, 0.58)"
          fillRule="evenodd"
        />
        <rect
          x={pixelRect.x}
          y={pixelRect.y}
          width={pixelRect.width}
          height={pixelRect.height}
          fill="none"
          stroke="rgb(94 234 212)"
          strokeWidth={strokeWidth}
          strokeDasharray={editable ? undefined : `${5 / zoom} ${4 / zoom}`}
        />
        {editable &&
          handles.map(([x, y], index) => (
            <rect
              key={index}
              x={x - handleSize / 2}
              y={y - handleSize / 2}
              width={handleSize}
              height={handleSize}
              rx={1.5 / Math.max(zoom, 0.01)}
              fill="rgb(15 23 42)"
              stroke="rgb(153 246 228)"
              strokeWidth={strokeWidth}
            />
          ))}
      </svg>
      <div
        className="absolute rounded bg-slate-950/90 px-2 py-1 font-mono text-[10px] text-teal-100 shadow-lg ring-1 ring-teal-300/30"
        style={{
          left: pixelRect.x,
          top: pixelRect.y,
          transform: `translateY(calc(-100% - ${6 / zoom}px)) scale(${1 / zoom})`,
          transformOrigin: 'bottom left',
        }}
      >
        ROI {pixelRect.width} × {pixelRect.height}
        <span className="ml-1.5 text-teal-300/70">{Math.round(coverage * 100)}% pixels</span>
      </div>
    </div>
  );
}
