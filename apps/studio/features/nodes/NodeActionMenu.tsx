import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as Icons from '@blackboard/icons';
import { usePreferences } from '@/state/preferencesContext';

export interface NodeAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  /** Extra class applied to the icon button when rendered pinned or inside the menu row */
  iconClassName?: string;
  onClick: (e: React.MouseEvent) => void;
  /** Whether this action is available (default true) */
  visible?: boolean;
  /** Whether the action should always render as a direct button before the menu */
  inline?: boolean;
  /** Whether the action should render disabled */
  disabled?: boolean;
}

/**
 * Renders a vertical three-dot menu for node actions.
 * Each action can be "pinned" — pinned actions are shown as direct buttons
 * before the kebab trigger so they're always one-click accessible.
 */
export const NodeActionMenu: React.FC<{ actions: NodeAction[] }> = ({ actions }) => {
  const { pinnedNodeActions, setPreferences } = usePreferences();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Compute dropdown position when opening
  const updatePos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      left: rect.right,
    });
  }, []);

  useEffect(() => {
    if (open) updatePos();
  }, [open, updatePos]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [open]);

  const visibleActions = actions.filter((a) => a.visible !== false);
  const pinnedSet = new Set(pinnedNodeActions);
  const inlineActionIds = new Set(visibleActions.filter((a) => a.inline).map((a) => a.id));
  const pinned = visibleActions.filter(
    (a) => a.inline || (pinnedSet.has(a.id) && !inlineActionIds.has(a.id)),
  );

  const togglePin = (actionId: string) => {
    const next = pinnedSet.has(actionId)
      ? pinnedNodeActions.filter((id) => id !== actionId)
      : [...pinnedNodeActions, actionId];
    setPreferences({ pinnedNodeActions: next });
  };

  return (
    <div className="flex items-center flex-shrink-0">
      {/* Inline/pinned action buttons (before the kebab so ellipsis stays rightmost) */}
      {pinned.map((action) => (
        <button
          key={action.id}
          disabled={action.disabled}
          onClick={(e) => {
            e.stopPropagation();
            action.onClick(e);
          }}
          className={
            action.iconClassName ??
            'w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white rounded'
          }
          title={action.label}
        >
          {action.icon}
        </button>
      ))}

      {/* Kebab trigger — always visible, always rightmost */}
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-white rounded hover:bg-gray-600/50"
        title="Actions"
      >
        <Icons.EllipsisVertical className="h-4 w-4" />
      </button>

      {/* Dropdown menu — portaled to body so it floats above all node rows */}
      {open &&
        pos &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] min-w-[160px] rounded-md border border-gray-600 bg-gray-800 shadow-lg py-1"
            style={{ top: pos.top, left: pos.left, transform: 'translateX(-100%)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {visibleActions.map((action) => {
              const isPinned = pinnedSet.has(action.id);
              return (
                <div key={action.id} className="flex items-center hover:bg-gray-700/60 group/row">
                  {/* Action button */}
                  <button
                    disabled={action.disabled}
                    className={`flex-1 flex items-center gap-2 px-3 py-1.5 text-xs ${
                      action.disabled
                        ? 'cursor-not-allowed text-gray-600'
                        : 'text-gray-300 hover:text-white'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      action.onClick(e);
                      setOpen(false);
                    }}
                  >
                    <span className="w-4 h-4 flex-shrink-0">{action.icon}</span>
                    <span>{action.label}</span>
                  </button>
                  {/* Pin toggle */}
                  <button
                    className={`w-6 h-6 flex items-center justify-center mr-1 rounded transition-colors ${
                      isPinned
                        ? 'text-primary-400'
                        : 'text-gray-600 opacity-0 group-hover/row:opacity-100 hover:text-gray-300'
                    }`}
                    title={isPinned ? 'Unpin' : 'Pin'}
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePin(action.id);
                    }}
                  >
                    <Icons.Pin className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
};
