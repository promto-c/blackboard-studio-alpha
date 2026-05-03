import React from 'react';
import * as Icons from '@blackboard/icons';
import { ToggleSwitch } from '@blackboard/ui';

type ViewportToolPanelHeaderToggle = {
  active: boolean;
  onToggle: () => void;
  activeLabel?: string;
  inactiveLabel?: string;
  ariaLabel?: string;
};

export const ViewportToolPanelHeader: React.FC<{
  title: string;
  onClose: () => void;
  toggle?: ViewportToolPanelHeaderToggle;
}> = ({ title, onClose, toggle }) => {
  const panelTitle = (
    <h3 className="text-xs font-semibold text-white uppercase tracking-wide">{title}</h3>
  );

  const closeButton = (
    <button
      type="button"
      onClick={onClose}
      className="text-gray-400 hover:text-white p-0.5 rounded-full hover:bg-white/10 transition-colors"
      aria-label={`Close ${title} panel`}
    >
      <Icons.XMark className="h-3.5 w-3.5" />
    </button>
  );

  if (!toggle) {
    return (
      <div className="mb-3 flex items-center justify-between">
        {panelTitle}
        {closeButton}
      </div>
    );
  }

  const toggleButton = (
    <ToggleSwitch
      checked={toggle.active}
      onCheckedChange={() => toggle.onToggle()}
      size="sm"
      ariaLabel={
        toggle.ariaLabel ??
        `${toggle.active ? (toggle.activeLabel ?? 'Disable') : (toggle.inactiveLabel ?? 'Enable')} ${title}`
      }
      trackClassName={
        toggle.active
          ? 'border border-primary-300/30 bg-primary-500/50'
          : 'border border-white/10 bg-white/10'
      }
      thumbClassName="shadow-sm"
    />
  );

  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="min-w-0 flex flex-wrap items-center gap-2">
        {toggleButton}
        {panelTitle}
      </div>
      {closeButton}
    </div>
  );
};

export const ViewportToolPanel: React.FC<{ children: React.ReactNode; width?: string }> = ({
  children,
  width = 'w-64',
}) => (
  <div
    className={`glass-component ${width} bg-gray-900/50 backdrop-blur-xl border border-white/10 rounded-lg shadow-lg p-3 pointer-events-auto animate-[fadeIn_150ms_ease-out]`}
    onMouseDown={(e) => e.stopPropagation()}
  >
    {children}
  </div>
);
