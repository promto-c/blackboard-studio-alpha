import React from 'react';

interface RotoControlPointProps {
  cx: number;
  cy: number;
  zoom: number;
  isSelected: boolean;
  isHovered: boolean;
  isDrawing?: boolean;
  isTemp?: boolean;
  onMouseDown?: (e: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const RotoControlPoint: React.FC<RotoControlPointProps> = ({
  cx,
  cy,
  zoom,
  isSelected,
  isHovered,
  isDrawing,
  isTemp,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
}) => {
  const baseRadius = 5 / zoom;
  const strokeWidth = 1 / zoom;

  let fill = 'transparent';
  let stroke = 'white';
  let glowRadius = 0;
  let glowOpacity = 0;

  if (isDrawing) {
    fill = 'transparent';
    stroke = 'white';
  } else if (isTemp) {
    fill = 'transparent';
    stroke = 'yellow';
  } else {
    if (isSelected) {
      fill = 'yellow';
      stroke = 'rgba(0,0,0,0.7)';
      glowRadius = baseRadius * 1.6;
      glowOpacity = 0.3;
    }

    if (isHovered) {
      fill = isSelected ? 'yellow' : 'rgba(255, 255, 255, 0.9)';
      glowRadius = baseRadius * 2;
      glowOpacity = isSelected ? 0.6 : 0.4;
    } else if (!isSelected) {
      fill = 'transparent';
      stroke = 'white';
    }
  }

  const canInteract = onMouseDown !== undefined;

  return (
    <g
      className={canInteract ? 'pointer-events-auto cursor-move' : 'pointer-events-none'}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ transition: 'opacity 150ms' }}
    >
      {canInteract && <circle cx={cx} cy={cy} r={baseRadius * 2} fill="transparent" />}

      {glowRadius > 0 && (
        <circle
          cx={cx}
          cy={cy}
          r={glowRadius}
          fill="yellow"
          opacity={glowOpacity}
          style={{ transition: 'r 150ms, opacity 150ms' }}
        />
      )}

      <circle
        cx={cx}
        cy={cy}
        r={baseRadius}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        style={{ transition: 'fill 150ms, stroke 150ms, stroke-width 150ms' }}
      />
    </g>
  );
};

export default RotoControlPoint;
