import React from 'react';

export const Alpha: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    viewBox="0 0 24 24"
    stroke="currentColor"
    fill="currentColor"
  >
    <path
      strokeWidth="1.5"
      d="M21 3.6v16.8a.6.6 0 01-.6.6H3.6a.6.6 0 01-.6-.6V3.6a.6.6 0 01.6.6h16.8a.6.6 0 01.6.6z"
      fill="none"
    />
    <path d="M3 12h9V3H3v9zm9 9h9v-9h-9v9z" fillOpacity="0.3" />
  </svg>
);
