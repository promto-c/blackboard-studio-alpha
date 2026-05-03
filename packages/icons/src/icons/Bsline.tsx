import React from 'react';

export const Bsline: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 17C3 17 6 11 12 11C18 11 21 17 21 17"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 7C3 7 6 13 12 13C18 13 21 7 21 7"
      strokeDasharray="3 3"
    />
  </svg>
);
