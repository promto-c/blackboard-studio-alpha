import React from 'react';

type IconComponent = React.ComponentType<{ className?: string }>;

export interface IconButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> {
  icon: IconComponent;
  tooltip: string;
  iconClassName?: string;
}

const IconButton: React.FC<IconButtonProps> = ({
  icon: Icon,
  tooltip,
  type = 'button',
  className,
  iconClassName,
  ...props
}) => (
  <button
    {...props}
    type={type}
    title={tooltip}
    aria-label={tooltip}
    className={[
      'inline-flex h-5 w-5 items-center justify-center rounded text-gray-500 transition hover:bg-white/[0.06] hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-50',
      className,
    ]
      .filter(Boolean)
      .join(' ')}
  >
    <Icon className={['h-4 w-4', iconClassName].filter(Boolean).join(' ')} />
  </button>
);

export default IconButton;
