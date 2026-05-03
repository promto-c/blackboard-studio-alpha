import React, { useCallback, useRef } from 'react';
import {
  handleStandardClipboardHotkeyEvent,
  type StandardClipboardHandlers,
} from '@/utils/standardClipboardHotkeys';

interface ItemsPanelLayoutProps {
  title: string;
  subtitle?: React.ReactNode;
  headerActions?: React.ReactNode;
  hasItems: boolean;
  emptyState: React.ReactNode;
  children: React.ReactNode;
  onDeleteSelected?: () => void;
  onSelectAll?: () => void;
  clipboardHotkeys?: StandardClipboardHandlers;
}

const isTextInput = (target: EventTarget | null): boolean => {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if (target.isContentEditable) return true;
  return false;
};

const ItemsPanelLayout: React.FC<ItemsPanelLayoutProps> = ({
  title,
  subtitle,
  headerActions,
  hasItems,
  emptyState,
  children,
  onDeleteSelected,
  onSelectAll,
  clipboardHotkeys,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (isTextInput(event.target)) return;
      if (handleStandardClipboardHotkeyEvent(event, clipboardHotkeys)) return;

      if (onSelectAll && !event.altKey && !event.shiftKey && (event.ctrlKey || event.metaKey)) {
        if (event.key.toLowerCase() === 'a') {
          event.preventDefault();
          event.stopPropagation();
          onSelectAll();
          return;
        }
      }

      if (!onDeleteSelected) return;
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;

      event.preventDefault();
      event.stopPropagation();
      onDeleteSelected();
    },
    [clipboardHotkeys, onDeleteSelected, onSelectAll],
  );

  const handlePointerDown = useCallback(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 flex-col overflow-hidden outline-none"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-2 py-1.5">
        <div className="min-w-0">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.11em] text-gray-300">
            {title}
          </h3>
          {subtitle ? (
            <div className="text-[10px] leading-none text-gray-500">{subtitle}</div>
          ) : null}
        </div>
        {headerActions ? <div className="flex items-center gap-1">{headerActions}</div> : null}
      </div>

      {hasItems ? (
        children
      ) : (
        <div className="flex flex-1 items-center justify-center p-4">{emptyState}</div>
      )}
    </div>
  );
};

export default ItemsPanelLayout;
