import React from 'react';

export const Blur: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    <circle cx="6" cy="12" r="1.5" fill="currentColor" opacity="1" />
    <circle cx="10" cy="12" r="1.5" fill="currentColor" opacity="0.75" />
    <circle cx="14" cy="12" r="1.5" fill="currentColor" opacity="0.5" />
    <circle cx="18" cy="12" r="1.5" fill="currentColor" opacity="0.25" />
  </svg>
);
