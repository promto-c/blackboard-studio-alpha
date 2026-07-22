import React from 'react';

/** A sampled closed contour, used for raster-to-vector tracing actions. */
export function ContourTrace({ className }: { className?: string }) {
  return (
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
        d="M6.25 17.7c-1.52-1.4-2.08-3.5-1.08-5.3.72-1.3 2.08-1.75 2.68-3.08.7-1.55.34-3.38 1.9-4.35 1.63-1 3.3.23 4.38 1.47 1.25 1.43 3.45 1.14 4.52 2.83 1.02 1.61.12 3.2-.9 4.44-1.46 1.78-3.86 2.5-6.13 2.26-1.94-.2-3.92-.8-5.37-2.27Z"
      />
      <circle cx="5.2" cy="12.4" r="1" fill="currentColor" stroke="none" />
      <circle cx="9.75" cy="4.97" r="1" fill="currentColor" stroke="none" />
      <circle cx="18.55" cy="9.27" r="1" fill="currentColor" stroke="none" />
      <circle cx="17.65" cy="13.71" r="1" fill="currentColor" stroke="none" />
      <circle cx="11.62" cy="15.97" r="1" fill="currentColor" stroke="none" />
      <circle cx="6.25" cy="17.7" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
