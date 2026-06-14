import React from 'react';

export function PowerOff({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2v8M18.36 5.64a9 9 0 11-12.72 0" />
      <path d="M4 20L20 4" />
    </svg>
  );
}
