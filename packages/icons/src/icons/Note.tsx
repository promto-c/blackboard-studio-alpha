import React from 'react';

export function Note({ className }: { className?: string }) {
  return (
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
        d="M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H8l-4-4V6z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 4v4a2 2 0 002 2h4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h8M8 16h4" />
    </svg>
  );
}
