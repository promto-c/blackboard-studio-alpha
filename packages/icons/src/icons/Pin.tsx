export const Pin = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.25}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M14 4l6 6-2.5 2.5-1.5-1.5-4 4V17a.75.75 0 01-1.28.53l-3.25-3.25A.75.75 0 018.25 13H10l4-4-1.5-1.5L14 4z"
    />
    <path d="M10 14.5L5 19.5" strokeLinecap="round" />
  </svg>
);
