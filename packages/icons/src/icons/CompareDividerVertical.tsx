import React from 'react';

export function CompareDividerVertical({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <rect
        x={3}
        y={4}
        width={18}
        height={16}
        rx={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 0.75v22.5" strokeLinecap="round" />
    </svg>
  );
}
