import React from 'react';

export const Pencil: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M16.862 3.487a2.002 2.002 0 012.828 2.828l-10.5 10.5a2.002 2.002 0 01-.622.417l-3.255 1.085a1.002 1.002 0 01-1.278-1.278l1.085-3.255a2.002 2.002 0 01.417-.622l10.5-10.5zm-8.5 8.5l3.5 3.5"
    />
  </svg>
);
