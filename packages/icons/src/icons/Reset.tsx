import React from 'react';

export const Reset: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M1 4v6h6" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.51 15a9 9 0 102.13-9.36L1 10" />
  </svg>
);
