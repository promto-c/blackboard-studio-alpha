import React, { useState } from 'react';
import * as Icons from '@blackboard/icons';
import { ScrollArea, SplitterHandle, ToggleSwitch } from '@blackboard/ui';

const VIEWPORT_TOOL_PANEL_DEFAULT_WIDTH = 320;
const VIEWPORT_TOOL_PANEL_MIN_WIDTH = 240;
const VIEWPORT_TOOL_PANEL_MAX_WIDTH = 480;

type ViewportToolPanelHeaderToggle = {
  active: boolean;
  onToggle: () => void;
  activeLabel?: string;
  inactiveLabel?: string;
  ariaLabel?: string;
};

export function ViewportToolPanelHeader({
  title,
  onClose,
  toggle,
}: {
  title: string;
  onClose: () => void;
  toggle?: ViewportToolPanelHeaderToggle;
}) {
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
}

export function ViewportToolPanelArea({ children }: { children: React.ReactNode }) {
  const [width, setWidth] = useState(VIEWPORT_TOOL_PANEL_DEFAULT_WIDTH);

  return (
    <div
      role="group"
      aria-label="Viewport tool panels"
      className="relative z-20 flex min-h-0 min-w-0 self-center pointer-events-none"
      style={{
        width,
        maxWidth: 'calc(100% - 4.5rem)',
        maxHeight: 'calc(100% - 2rem)',
      }}
    >
      <ScrollArea
        axis="y"
        fadeEdges={{ backdropBlur: 16, size: 32 }}
        rootClassName="pointer-events-auto max-h-full min-h-0 w-full"
        viewportClassName="max-h-full min-h-0 overscroll-contain"
        contentClassName="flex w-full flex-col gap-2 pr-1"
      >
        {children}
      </ScrollArea>
      <SplitterHandle
        axis="x"
        label="Tool panels"
        title="Resize tool panels"
        value={width}
        min={VIEWPORT_TOOL_PANEL_MIN_WIDTH}
        max={VIEWPORT_TOOL_PANEL_MAX_WIDTH}
        defaultValue={VIEWPORT_TOOL_PANEL_DEFAULT_WIDTH}
        onChange={setWidth}
      />
    </div>
  );
}

export function ViewportToolPanel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="glass-component w-full flex-none bg-gray-900/50 backdrop-blur-xl border border-white/10 rounded-lg shadow-lg p-3 pointer-events-auto animate-[fadeIn_150ms_ease-out]"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

export function ViewportToolPanelSectionStack({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`-mx-3 -mb-3 overflow-hidden rounded-b-[calc(0.5rem-1px)] border-t border-white/[0.08] bg-black/[0.12] divide-y divide-white/[0.08]${className ? ` ${className}` : ''}`}
    >
      {children}
    </div>
  );
}

export function ViewportToolPanelSection({
  children,
  className = '',
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={`p-3${className ? ` ${className}` : ''}`} {...props}>
      {children}
    </section>
  );
}
