import React from 'react';

export const Play: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M6.5 5.75c0-.86.93-1.4 1.68-.97l10.26 5.9a1.5 1.5 0 010 2.64L8.18 19.22c-.75.43-1.68-.11-1.68-.97V5.75z" />
  </svg>
);
