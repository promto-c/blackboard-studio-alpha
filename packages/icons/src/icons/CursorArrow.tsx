import React from 'react';

export const CursorArrow: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    <path d="M5 3.5v17l4.7-4.05 3.08 5.42 1.76-1.01-3.08-5.42 6.31-1.79L5 3.5z" />
  </svg>
);
