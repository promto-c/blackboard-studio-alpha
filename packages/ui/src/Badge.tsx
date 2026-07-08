import React from 'react';

export interface BadgeProps {
  children: React.ReactNode;
  /** Visual tone for the badge coloring */
  variant?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
  /** Size controls padding and font-size */
  size?: 'sm' | 'md' | 'lg';
  /** Render text in uppercase with letter-spacing */
  uppercase?: boolean;
  /** Truncate long content with ellipsis */
  truncate?: boolean;
  /** Prevent the badge from shrinking in a flex container */
  shrink?: boolean;
  /** Remove the default border */
  noBorder?: boolean;
  /** Additional class names applied after the base styles */
  className?: string;
  /** Native HTML title attribute for tooltip */
  title?: string;
}

const variantStyles: Record<string, string> = {
  neutral: 'border-white/10 bg-white/[0.05] text-gray-300',
  success: 'border-green-400/20 bg-green-500/10 text-green-100',
  warning: 'border-amber-400/20 bg-amber-500/10 text-amber-100',
  danger: 'border-red-400/20 bg-red-500/10 text-red-100',
  accent: 'border-primary-400/20 bg-primary-500/10 text-primary-100',
};

const sizeStyles: Record<string, string> = {
  sm: 'px-1.5 py-0.5 text-[9px]',
  md: 'px-2 py-0.5 text-[11px]',
  lg: 'px-2.5 py-1 text-[11px]',
};

/**
 * A reusable Badge component for labels, status indicators, and chips.
 * Uses `rounded-md` for a rounded-rectangle shape.
 */
export function Badge({
  children,
  variant = 'neutral',
  size = 'md',
  uppercase = false,
  truncate = false,
  shrink = false,
  noBorder = false,
  className = '',
  title,
}: BadgeProps) {
  return (
    <span
      className={`inline-flex min-w-0 max-w-full items-center rounded-md font-medium ${sizeStyles[size]} ${
        noBorder ? 'border-0' : 'border'
      } ${variantStyles[variant]} ${
        uppercase ? 'uppercase tracking-[0.12em]' : ''
      } ${shrink ? 'shrink-0' : ''} ${className}`}
      title={title}
    >
      {truncate ? <span className="min-w-0 truncate">{children}</span> : children}
    </span>
  );
}
