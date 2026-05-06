import React from 'react';
import { formatIncrementBadgeStep } from '../utils/comfyControlValues';

export const IncrementRunModeIcon: React.FC<{
  className?: string;
  step: number;
  isAnimating?: boolean;
}> = ({ className, step, isAnimating = false }) => {
  const stepLabel = formatIncrementBadgeStep(step);
  const isNegative = step < 0;
  const textSize = stepLabel.length > 1 ? 7.2 : 10;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7.25 3.75h8.55c1.24 0 2.25 1.01 2.25 2.25v1.05"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.25 7.15v9.6c0 1.38 1.12 2.5 2.5 2.5h8.05c1.38 0 2.5-1.12 2.5-2.5v-1.5"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <text
        x="11.0"
        y="15.5"
        textAnchor="middle"
        fill="currentColor"
        fontSize={textSize}
        fontWeight="500"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace"
      >
        {stepLabel}
      </text>

      <g
        className={
          isAnimating
            ? 'origin-center motion-safe:animate-[incrementArrow_520ms_cubic-bezier(0.22,1,0.36,1)_1]'
            : undefined
        }
        style={{ transformOrigin: '18.5px 11.5px' }}
      >
        <path
          d={isNegative ? 'M18.5 7.1v9.2' : 'M18.5 16.3V7.1'}
          stroke="var(--increment-icon-accent, currentColor)"
          strokeWidth={1.9}
          strokeLinecap="round"
        />
        <path
          d={isNegative ? 'M15.9 13.7L18.5 16.3L21.1 13.7' : 'M15.9 9.7L18.5 7.1L21.1 9.7'}
          stroke="var(--increment-icon-accent, currentColor)"
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
};
