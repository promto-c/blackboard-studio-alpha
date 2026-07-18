type AlphaMathIconProps = {
  className?: string;
  operation: 'multiply' | 'divide';
};

function AlphaMathIcon({ className, operation }: AlphaMathIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="3" y="3" width="15" height="15" rx="1.5" />
      <path d="M3 10.5h7.5V3M10.5 18v-7.5H18" opacity="0.45" fill="currentColor" />
      <circle cx="17.5" cy="17.5" r="4" fill="currentColor" stroke="none" />
      {operation === 'multiply' ? (
        <path d="m15.9 15.9 3.2 3.2m0-3.2-3.2 3.2" stroke="var(--bb-icon-badge, #111827)" />
      ) : (
        <>
          <path d="M15.7 17.5h3.6" stroke="var(--bb-icon-badge, #111827)" />
          <circle cx="17.5" cy="15.9" r="0.45" fill="var(--bb-icon-badge, #111827)" stroke="none" />
          <circle cx="17.5" cy="19.1" r="0.45" fill="var(--bb-icon-badge, #111827)" stroke="none" />
        </>
      )}
    </svg>
  );
}

export function PremultiplyIcon({ className }: { className?: string }) {
  return <AlphaMathIcon className={className} operation="multiply" />;
}

export function UnpremultiplyIcon({ className }: { className?: string }) {
  return <AlphaMathIcon className={className} operation="divide" />;
}
