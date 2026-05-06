import React from 'react';

export const ChatBubble: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    {/* Bubble outline */}
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="
        M16.25 4.95
        H7.35
        C4.65 4.95 3.15 6.55 3.15 9.15
        V13.4
        C3.15 16 4.65 17.6 7.35 17.6
        H7.75
        V20.15
        L11.45 17.6
        H16.25
      "
    />

    {/* Right side segment, separated from sparkle */}
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="
        M19.35 8.7
        V13.55
        C19.35 16.15 17.85 17.6 16.25 17.6
      "
    />

    {/* Message lines */}
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.7 9.95H14.5" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.7 12.9H10.95" />

    {/* Sparkle shifted left a bit */}
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="
        M19.05 2.15
        L19.47 3.3
        C19.6 3.66 19.89 3.95 20.25 4.08
        L21.4 4.5
        L20.25 4.92
        C19.89 5.05 19.6 5.34 19.47 5.7
        L19.05 6.85
        L18.63 5.7
        C18.5 5.34 18.21 5.05 17.85 4.92
        L16.7 4.5
        L17.85 4.08
        C18.21 3.95 18.5 3.66 18.63 3.3
        L19.05 2.15
        Z
      "
    />
  </svg>
);
