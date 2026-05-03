import React from 'react';

export const Transform: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h10v10H7z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10h4" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M17 3h4v4" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 17v4h-4" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M7 3H3v4" />
  </svg>
);
