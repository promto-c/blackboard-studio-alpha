import React, { useState } from 'react';
import * as Icons from '@blackboard/icons';
import { Popover } from '@blackboard/ui';

const MENU_SECTION_LABEL_CLASS =
  'px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500';
const MENU_ITEM_CLASS =
  'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-gray-200 transition-colors hover:bg-white/10 hover:text-white';
const MENU_ITEM_DANGER_CLASS =
  'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-red-200 transition-colors hover:bg-red-500/15 hover:text-red-100';

export const HEADER_SELECTION_CHIP_CLASS =
  'flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] p-0.5 pl-1 text-[11px] text-gray-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]';
export const HEADER_SELECTION_ICON_BUTTON_CLASS =
  'flex h-5 w-5 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-100';

export const LayerPlusIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    className={className ?? 'h-4 w-4'}
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 7C4 5.89543 4.89543 5 6 5H10L12.5 7H18C19.1046 7 20 7.89543 20 9V17C20 18.1046 19.1046 19 18 19H6C4.89543 19 4 18.1046 4 17V7Z" />
    <path d="M15 12H19" />
    <path d="M17 10V14" />
  </svg>
);

export const MenuSectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className={MENU_SECTION_LABEL_CLASS}>{children}</div>
);

export const MenuButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  active?: boolean;
  disabled?: boolean;
}> = ({ icon, label, onClick, danger = false, active = false, disabled = false }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`${danger ? MENU_ITEM_DANGER_CLASS : MENU_ITEM_CLASS} ${
      active && !danger
        ? 'bg-primary-500/12 text-primary-100 ring-1 ring-inset ring-primary-500/30'
        : ''
    } ${disabled ? 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-inherit' : ''}`}
  >
    <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">{icon}</span>
    <span className="truncate">{label}</span>
  </button>
);

export const FloatingMenu: React.FC<{
  trigger: React.ReactElement;
  widthClass?: string;
  children: (close: () => void) => React.ReactNode;
}> = ({ trigger, widthClass = 'w-60', children }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Popover
      trigger={trigger}
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      widthClass={widthClass}
      align="end"
      sideOffset={6}
    >
      {(close) =>
        children(() => {
          close();
          setIsOpen(false);
        })
      }
    </Popover>
  );
};

export type LayerOption = {
  id: string;
  label: string;
};

export const countLabel = (count: number, singular: string, plural: string) =>
  `${count} ${count === 1 ? singular : plural}`;

export const MoveMenuSection: React.FC<{
  options: LayerOption[];
  currentValue?: string | null;
  label?: string;
  onMove: (targetLayerId: string | null) => void;
  close: () => void;
}> = ({ options, currentValue, label = 'Move To', onMove, close }) => (
  <div className="space-y-1">
    <MenuSectionLabel>{label}</MenuSectionLabel>
    <MenuButton
      icon={<Icons.Branch className="h-4 w-4" />}
      label="Root"
      active={currentValue === null}
      onClick={() => {
        onMove(null);
        close();
      }}
    />
    {options.length > 0 ? (
      <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
        {options.map((option) => (
          <MenuButton
            key={option.id}
            icon={<Icons.FolderOpen className="h-4 w-4" />}
            label={option.label}
            active={currentValue === option.id}
            onClick={() => {
              onMove(option.id);
              close();
            }}
          />
        ))}
      </div>
    ) : (
      <p className="px-2.5 pb-1 text-[11px] text-gray-500">No layers available yet.</p>
    )}
  </div>
);
