export function KeyerIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5.5h16v13H4z" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 15.5c.7-2.4 2-3.6 4-3.6s3.3 1.2 4 3.6"
      />
      <circle cx="12" cy="8.5" r="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M18.5 3v4M16.5 5h4" />
    </svg>
  );
}
