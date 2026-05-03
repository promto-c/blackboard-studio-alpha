import React from 'react';

export const CubeTransparent: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M12 2.75 4.5 7v10L12 21.25 19.5 17V7L12 2.75Zm0 0V11m0 10.25V11m0 0L4.5 7m7.5 4 7.5-4"
    />
  </svg>
);
