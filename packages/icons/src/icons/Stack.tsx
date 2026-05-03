import React from 'react';

export const Stack: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    {/* Three stacked horizontal lines with slight offsets to convey depth */}
    <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h10M5 12h14M7 17h10" />
  </svg>
);
