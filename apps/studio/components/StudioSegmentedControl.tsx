import React from 'react';

export interface StudioSegmentedControlProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export interface StudioSegmentedControlButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  activeClassName?: string;
  inactiveClassName?: string;
}

const CONTROL_CLASS =
  'flex items-center gap-1 rounded-md border border-white/10 bg-black/20 p-0.5 text-[10px]';
const BUTTON_CLASS = 'px-2 py-1 tracking-wider font-semibold rounded transition-all';
const ACTIVE_BUTTON_CLASS = 'bg-gray-700 text-white shadow-sm';
const INACTIVE_BUTTON_CLASS = 'text-gray-500 hover:text-gray-300 hover:bg-white/5';

export const StudioSegmentedControl = React.forwardRef<HTMLDivElement, StudioSegmentedControlProps>(
  ({ children, className = '', style }, ref) => {
    const classes = className ? `${CONTROL_CLASS} ${className}` : CONTROL_CLASS;
    return (
      <div ref={ref} className={classes} style={style}>
        {children}
      </div>
    );
  },
);

StudioSegmentedControl.displayName = 'StudioSegmentedControl';

export const StudioSegmentedControlButton: React.FC<StudioSegmentedControlButtonProps> = ({
  active = false,
  activeClassName = ACTIVE_BUTTON_CLASS,
  inactiveClassName = INACTIVE_BUTTON_CLASS,
  className = '',
  type = 'button',
  ...props
}) => {
  const stateClassName = active ? activeClassName : inactiveClassName;
  const classes = `${BUTTON_CLASS} ${stateClassName}${className ? ` ${className}` : ''}`;

  return <button type={type} className={classes} {...props} />;
};
