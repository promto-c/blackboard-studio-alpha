import React from 'react';

export function Branch({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Main left trunk */}
      <path d="M7 5v14" />
      {/* Branch merges into the main trunk */}
      <path d="M17 5v3c0 2.2-1.8 4-4 4H7" />
      {/* Nodes */}
      <circle cx="7" cy="5" r="1.9" />
      <circle cx="17" cy="5" r="1.9" />
      <circle cx="7" cy="19" r="1.9" />
    </svg>
  );
}
