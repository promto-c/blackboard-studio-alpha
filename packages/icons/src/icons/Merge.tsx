import React from 'react';

export const Merge: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    {/* Two input lines converging into a single vertical output */}
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 4l6 6M18 4l-6 6M12 10v10" />
  </svg>
);
