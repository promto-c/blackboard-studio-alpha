import type { DataWindowRect } from './dataWindow';

interface ViewportWindowLabelsProps {
  visible: boolean;
  zoom: number;
  displayWindowRect: { x: number; y: number; width: number; height: number } | null;
  dataWindowRect: DataWindowRect | null;
  showDataWindow: boolean;
  dataWindowIsHandled: boolean;
}

export const formatViewportWindowSize = (width: number, height: number) =>
  `${Math.round(Math.abs(width))} x ${Math.round(Math.abs(height))}`;

const dataWindowSizeChanged = (rect: DataWindowRect) =>
  Math.round(Math.abs(rect.width)) !== Math.round(Math.abs(rect.nativeWidth)) ||
  Math.round(Math.abs(rect.height)) !== Math.round(Math.abs(rect.nativeHeight));

/** Native scene-space labels shared by normal and Compare viewport presentations. */
export function ViewportWindowLabels({
  visible,
  zoom,
  displayWindowRect,
  dataWindowRect,
  showDataWindow,
  dataWindowIsHandled,
}: ViewportWindowLabelsProps) {
  if (!visible) return null;

  const safeZoom = Math.max(zoom, 0.001);
  const inverseZoom = 1 / safeZoom;
  const nativeSizeChanged = dataWindowRect ? dataWindowSizeChanged(dataWindowRect) : false;

  return (
    <div className="absolute inset-0 pointer-events-none">
      {displayWindowRect && displayWindowRect.width > 150 && (
        <div
          data-viewport-window-label="display"
          className="absolute top-0 left-0 bg-cyan-900/80 text-cyan-200 text-[10px] px-1.5 py-0.5 font-mono"
          style={{
            left: displayWindowRect.x,
            top: displayWindowRect.y,
            transform: `translate(${-inverseZoom}px, -100%) scale(${inverseZoom})`,
            transformOrigin: 'bottom left',
          }}
        >
          <span className="text-cyan-300">Display Window</span>{' '}
          <span className="text-cyan-100">
            {formatViewportWindowSize(displayWindowRect.width, displayWindowRect.height)}
          </span>
        </div>
      )}
      {showDataWindow && dataWindowRect && dataWindowRect.width > 150 && (
        <div
          data-viewport-window-label="data"
          className="absolute bg-amber-950/90 text-amber-200 text-[10px] px-1.5 py-0.5 font-mono shadow-sm shadow-black/30"
          style={{
            left: dataWindowRect.x,
            top: dataWindowRect.y,
            transform: `translate(${-inverseZoom}px, -100%) scale(${inverseZoom})`,
            transformOrigin: 'bottom left',
          }}
          title={`Data Window: ${formatViewportWindowSize(
            dataWindowRect.width,
            dataWindowRect.height,
          )}${
            dataWindowIsHandled && nativeSizeChanged
              ? `. Native before this node: ${formatViewportWindowSize(
                  dataWindowRect.nativeWidth,
                  dataWindowRect.nativeHeight,
                )}`
              : ''
          }`}
        >
          <span className="text-amber-300">Data Window</span>{' '}
          <span className="whitespace-nowrap text-amber-100">
            {formatViewportWindowSize(dataWindowRect.width, dataWindowRect.height)}
            {dataWindowIsHandled && nativeSizeChanged && (
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
                {formatViewportWindowSize(dataWindowRect.nativeWidth, dataWindowRect.nativeHeight)}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
