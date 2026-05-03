import React from 'react';

export const PaintNodeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="4.5" y="4.5" width="15" height="15" rx="2.75" />
    <path d="M7.25 15.05c1.14-1.7 2.76-2.55 4.86-2.55 1.44 0 2.83.29 4.17.88" />
    <path d="M14.9 6.1l2.95 2.95" />
    <path d="M12.4 8.6l3 3-1.9 1.9-3-3z" />
  </svg>
);
