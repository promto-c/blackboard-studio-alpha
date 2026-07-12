import React from 'react';

export function CompareViewportReference({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
    >
      <path
        d="M4.5 4h15A1.5 1.5 0 0121 5.5v11A1.5 1.5 0 0119.5 18h-15A1.5 1.5 0 013 16.5v-11A1.5 1.5 0 014.5 4z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 14.5h18M8.5 21h7M10 18l-.75 3M14 18l.75 3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 6.75v5.75" strokeLinecap="round" />
      <circle cx={12} cy={12.5} r={1.35} fill="currentColor" stroke="none" />
    </svg>
  );
}
