import React from 'react';

export const LiquidGlass: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M7 12c1.5-2 3.5-2 5 0s3.5 2 5 0" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 7c-2 1.5-2 3.5 0 5s2 3.5 0 5" />
  </svg>
);
