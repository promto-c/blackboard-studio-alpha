import React from 'react';
import * as Icons from '@blackboard/icons';
import { ScrollArea } from '@blackboard/ui';

interface SettingsPanelFrameProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  sidebar: React.ReactNode;
  children: React.ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  uiStyle?: 'glass' | 'solid';
  contentClassName?: string;
}

const SettingsPanelFrame: React.FC<SettingsPanelFrameProps> = ({
  title,
  subtitle,
  sidebar,
  children,
  onClose,
  closeLabel = 'Close panel',
  uiStyle = 'glass',
  contentClassName = '',
}) => {
  const isSolid = uiStyle === 'solid';

  return (
    <div
      data-text-selection-scope
      className={`flex max-h-[calc(100dvh-3rem)] flex-col overflow-hidden rounded-[1.2rem] border shadow-[0_28px_80px_rgba(0,0,0,0.4)] ring-1 ring-inset ring-white/10 sm:max-h-[calc(100dvh-4rem)] ${
        isSolid
          ? 'border-white/10 bg-gray-950/95'
          : 'border-white/10 bg-gray-950/75 backdrop-blur-2xl supports-[backdrop-filter]:bg-gray-950/60'
      }`}
    >
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-medium text-white">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p> : null}
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            title={closeLabel}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/50"
          >
            <Icons.XMark className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="grid min-h-0 md:grid-cols-[170px_minmax(0,1fr)] lg:grid-cols-[180px_minmax(0,1fr)]">
        <aside
          className={`min-h-0 border-b border-white/10 md:border-b-0 md:border-r ${
            isSolid
              ? 'bg-black/35'
              : 'bg-black/25 backdrop-blur-xl supports-[backdrop-filter]:bg-black/15'
          }`}
        >
          <ScrollArea
            containerClassName="h-full min-h-0"
            className="h-full min-h-0 overflow-y-auto px-2 py-2"
          >
            {sidebar}
          </ScrollArea>
        </aside>

        <ScrollArea
          containerClassName="min-h-0 min-w-0"
          className={`h-full min-h-0 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5 ${contentClassName}`}
        >
          {children}
        </ScrollArea>
      </div>
    </div>
  );
};

export default SettingsPanelFrame;
