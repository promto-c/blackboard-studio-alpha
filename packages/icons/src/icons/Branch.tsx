import React from 'react';

export const Branch: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    {/* top node */}
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3a3 3 0 110 6 3 3 0 010-6z" />
    {/* left bottom node */}
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 15a3 3 0 110 6 3 3 0 010-6z" />
    {/* right bottom node */}
    <path strokeLinecap="round" strokeLinejoin="round" d="M18 15a3 3 0 110 6 3 3 0 010-6z" />
    {/* connections */}
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m0 0h-6m6 0h6" />
  </svg>
);
