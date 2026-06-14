import React from 'react';

export function ArrowsPointingOut({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 8V4h4m12 4V4h-4M4 16v4h4m12-4v4h-4"
      />
    </svg>
  );
}
