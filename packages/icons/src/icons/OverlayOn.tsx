import React from 'react';

export const OverlayOn: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.6}
  >
    <rect x="4" y="4" width="16" height="16" rx="1.8" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v8M8 12h8" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h2M4 16h2M18 8h2M18 16h2" />
  </svg>
);
