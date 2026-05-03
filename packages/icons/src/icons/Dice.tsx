import React from 'react';

export const Dice: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 3.75 18.3 7.85 12 11.95 5.7 7.85 12 3.75Z" />
    <path d="M5.7 7.85v8.3L12 20.25v-8.3" />
    <path d="M18.3 7.85v8.3L12 20.25" />
    <circle cx="12" cy="7.85" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="8.85" cy="11.6" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="7.3" cy="15.65" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="16.1" cy="10.65" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="14.3" cy="14.35" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="16.85" cy="16.3" r="1.05" fill="currentColor" stroke="none" />
  </svg>
);
