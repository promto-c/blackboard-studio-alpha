export interface ViewportFrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}

interface ViewportFrameOverlayProps {
  rect: ViewportFrameRect | null;
  dimOpacity?: number;
}

const formatNumber = (value: number) => Number(value.toFixed(3));

const createOutsideFramePath = (rect: ViewportFrameRect): string => {
  const viewportWidth = formatNumber(rect.viewportWidth);
  const viewportHeight = formatNumber(rect.viewportHeight);
  const left = formatNumber(rect.left);
  const top = formatNumber(rect.top);
  const right = formatNumber(rect.left + rect.width);
  const bottom = formatNumber(rect.top + rect.height);

  return [
    `M 0 0 H ${viewportWidth} V ${viewportHeight} H 0 Z`,
    `M ${left} ${top} H ${right} V ${bottom} H ${left} Z`,
  ].join(' ');
};

export function ViewportFrameOverlay({ rect, dimOpacity = 0.44 }: ViewportFrameOverlayProps) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden" aria-hidden="true">
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${Math.max(1, rect.viewportWidth)} ${Math.max(1, rect.viewportHeight)}`}
        preserveAspectRatio="none"
      >
        <path
          d={createOutsideFramePath(rect)}
          fill="rgb(8 8 8)"
          fillOpacity={dimOpacity}
          fillRule="evenodd"
        />
      </svg>
      <div
        className="absolute border border-white/55 shadow-[0_0_0_1px_rgba(0,0,0,0.55),0_0_20px_rgba(0,0,0,0.32)]"
        style={{
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }}
      />
    </div>
  );
}
