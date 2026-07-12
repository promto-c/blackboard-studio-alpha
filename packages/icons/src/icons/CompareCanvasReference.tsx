import React from 'react';

export function CompareCanvasReference({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
    >
      <rect
        x={4}
        y={4}
        width={16}
        height={16}
        rx={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8.5 7.75h7M7.5 12h9M8.5 16.25h7" strokeLinecap="round" strokeOpacity={0.5} />
      <path d="M12 4v16" strokeLinecap="round" />
      <path
        d="M2.5 6.5v-3h3M18.5 3.5h3v3M21.5 17.5v3h-3M5.5 20.5h-3v-3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
