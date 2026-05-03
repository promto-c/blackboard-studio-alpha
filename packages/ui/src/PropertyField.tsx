import React from 'react';

export interface PropertyFieldProps {
  label?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
}

const PropertyField: React.FC<PropertyFieldProps> = ({
  label,
  description,
  actions,
  children,
  className,
  headerClassName,
  contentClassName,
}) => {
  const hasHeader = label !== undefined || description !== undefined || actions !== undefined;
  const descriptionTitle = typeof description === 'string' ? description : undefined;

  return (
    <div
      className={['rounded-lg border border-white/10 bg-white/[0.03] p-3', className]
        .filter(Boolean)
        .join(' ')}
    >
      {hasHeader ? (
        <div
          className={['mb-2 flex items-center justify-between gap-3', headerClassName]
            .filter(Boolean)
            .join(' ')}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {label !== undefined ? (
              <span className="max-w-[45%] shrink-0 truncate text-xs font-medium text-gray-400">
                {label}
              </span>
            ) : null}
            {description !== undefined ? (
              <span
                title={descriptionTitle}
                className="min-w-0 flex-1 truncate text-[11px] leading-4 text-gray-500"
              >
                {description}
              </span>
            ) : null}
          </div>
          {actions !== undefined ? (
            <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
          ) : null}
        </div>
      ) : null}
      <div className={contentClassName}>{children}</div>
    </div>
  );
};

export default PropertyField;
