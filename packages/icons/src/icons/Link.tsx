import React from 'react';

export const Link: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M10 13a5 5 0 007.07 0l2.12-2.12a5 5 0 10-7.07-7.07L10 5m4 6a5 5 0 00-7.07 0L4.81 13.12a5 5 0 107.07 7.07L14 19"
    />
  </svg>
);
