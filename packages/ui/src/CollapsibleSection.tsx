import React, { useState } from 'react';
import { ChevronDown } from '@blackboard/icons';

interface CollapsibleSectionProps {
  title: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
  collapsedAction?: React.ReactNode;
  defaultOpen?: boolean;
  isSelected?: boolean;
  onTitleClick?: () => void;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  children,
  action,
  collapsedAction,
  defaultOpen = true,
  isSelected = false,
  onTitleClick,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const handleToggle = () => {
    onTitleClick?.();
    setIsOpen((prev) => !prev);
  };

  return (
    <div
      className={`overflow-hidden border-b transition-colors last:border-b-0 ${
        isSelected
          ? 'border-primary-500/35 bg-primary-900/10'
          : 'border-white/10 bg-transparent hover:bg-white/[0.02]'
      }`}
    >
      <div
        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors ${
          isSelected ? 'bg-primary-900/5' : 'hover:bg-white/[0.03]'
        }`}
      >
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={handleToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 flex-shrink-0 transform text-gray-500 transition-transform duration-200 ${
              isOpen ? 'rotate-0' : '-rotate-90'
            }`}
          />
          <span
            className={`truncate text-[10px] font-semibold uppercase tracking-[0.12em] ${
              isSelected ? 'text-primary-100' : 'text-gray-300'
            }`}
          >
            {title}
          </span>
        </button>
        {(action || (!isOpen && collapsedAction)) && (
          <div className="shrink-0">{isOpen ? action : (collapsedAction ?? action)}</div>
        )}
      </div>
      {isOpen && <div className="px-3 pb-3 pt-0.5">{children}</div>}
    </div>
  );
};

export default CollapsibleSection;
