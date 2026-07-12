import React from 'react';

export function CompareWipe({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
    >
      <path
        d="M4.5 4h15A1.5 1.5 0 0121 5.5v13a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18.5v-13A1.5 1.5 0 014.5 4z"
        fill="currentColor"
        fillOpacity={0.08}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 4v16" strokeLinecap="round" />
      <path d="M6.25 8.25h3M6.25 12h3M6.25 15.75h3" strokeLinecap="round" strokeOpacity={0.45} />
      <path d="M14.75 8.25h3M14.75 12h3M14.75 15.75h3" strokeLinecap="round" />
      <path
        d="M9.75 12l-1.5-1.5M9.75 12l-1.5 1.5M14.25 12l1.5-1.5M14.25 12l1.5 1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
