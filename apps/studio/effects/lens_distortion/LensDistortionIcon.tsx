import React from 'react';

export const LensDistortionIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M4 4h16v16H4z"
      stroke="none"
      fill="none"
    />
    <path strokeLinecap="round" strokeLinejoin="round" d="M8,4 C4,4 4,8 4,12 C4,16 4,20 8,20" />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16,4 C20,4 20,8 20,12 C20,16 20,20 16,20"
    />
    <path strokeLinecap="round" strokeLinejoin="round" d="M4,8 C4,4 8,4 12,4 C16,4 20,4 20,8" />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M4,16 C4,20 8,20 12,20 C16,20 20,20 20,16"
    />
  </svg>
);
