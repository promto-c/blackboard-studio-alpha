import React from 'react';

export const Paste: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9.25 4.75h5.5
         c0-1.243-1.12-2.25-2.5-2.25s-2.5 1.007-2.5 2.25Z"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M8.25 4.75h-1
         a2.5 2.5 0 0 0-2.5 2.5v10
         a2.5 2.5 0 0 0 2.5 2.5h10
         a2.5 2.5 0 0 0 2.5-2.5v-10
         a2.5 2.5 0 0 0-2.5-2.5h-1"
    />
  </svg>
);
