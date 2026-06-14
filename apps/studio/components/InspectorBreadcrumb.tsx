import React, { useMemo } from 'react';

export interface InspectorBreadcrumbSegment {
  id: string;
  label: React.ReactNode;
  active?: boolean;
  title?: string;
  onClick?: () => void;
}

export interface InspectorBreadcrumbProps {
  root: InspectorBreadcrumbSegment;
  items?: InspectorBreadcrumbSegment[];
  maxItems?: number;
  className?: string;
}

type RenderSegment =
  | (InspectorBreadcrumbSegment & { kind?: 'segment' })
  | { id: '__ellipsis__'; label: React.ReactNode; kind: 'ellipsis' };

function BreadcrumbButton({ segment }: { segment: InspectorBreadcrumbSegment }) {
  const className = `min-w-0 truncate text-left transition-colors ${
    segment.active ? 'text-gray-100' : 'text-gray-400 hover:text-gray-200'
  }`;

  if (!segment.onClick) {
    return (
      <span className={className} title={segment.title}>
        {segment.label}
      </span>
    );
  }

  return (
    <button type="button" onClick={segment.onClick} className={className} title={segment.title}>
      {segment.label}
    </button>
  );
}

export function InspectorBreadcrumb({
  root,
  items = [],
  maxItems = 4,
  className = '',
}: InspectorBreadcrumbProps) {
  const renderItems = useMemo<RenderSegment[]>(() => {
    if (items.length <= maxItems) return items;
    const first = items[0];
    const last = items[items.length - 1];
    const secondLast = items[items.length - 2];
    return [first, { id: '__ellipsis__', label: '...', kind: 'ellipsis' }, secondLast, last].filter(
      Boolean,
    ) as RenderSegment[];
  }, [items, maxItems]);

  return (
    <span className={`flex min-w-0 items-center gap-1 text-xs font-medium ${className}`}>
      <BreadcrumbButton segment={root} />
      {renderItems.map((item) => (
        <React.Fragment key={item.id}>
          <span className="shrink-0 px-0.5 text-gray-600">›</span>
          {item.kind === 'ellipsis' ? (
            <span className="px-1 text-gray-600">{item.label}</span>
          ) : (
            <BreadcrumbButton segment={item} />
          )}
        </React.Fragment>
      ))}
    </span>
  );
}
