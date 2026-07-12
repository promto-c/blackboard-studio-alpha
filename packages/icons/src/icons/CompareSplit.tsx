import React from 'react';

export function CompareSplit({ className }: { className?: string }) {
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
        x={3}
        y={4}
        width={8}
        height={16}
        rx={1.5}
        fill="currentColor"
        fillOpacity={0.1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x={13}
        y={4}
        width={8}
        height={16}
        rx={1.5}
        fill="currentColor"
        fillOpacity={0.1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M5.75 8.5h2.5M5.75 12h2.5M5.75 15.5h2.5" strokeLinecap="round" strokeOpacity={0.5} />
      <path d="M15.75 8.5h2.5M15.75 12h2.5M15.75 15.5h2.5" strokeLinecap="round" />
    </svg>
  );
}
