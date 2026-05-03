import React from 'react';

export const OffsetRing: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.9}
  >
    <circle cx="12" cy="12" r="8.2" strokeDasharray="2.4 2.2" />
    <circle cx="12" cy="12" r="1.55" fill="currentColor" stroke="none" />
    <circle cx="17.2" cy="8.1" r="1.65" fill="currentColor" stroke="none" />
  </svg>
);
