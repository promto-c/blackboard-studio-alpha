import React from 'react';
import * as Icons from '@blackboard/icons';
import {
  FloatingMenu,
  LayerPlusIcon,
  MenuButton,
  MenuSectionLabel,
  MoveMenuSection,
  type LayerOption,
} from './ItemsPanelMenus';
import {
  ROW_MENU_TRIGGER_CLASS,
  TREE_COUNT_BADGE_CLASS,
  TREE_COUNT_BADGE_IDLE_CLASS,
  TREE_COUNT_BADGE_SELECTED_CLASS,
  TREE_LEADING_BUTTON_CLASS,
  TREE_PRIMARY_BUTTON_CLASS,
  TREE_ROW_ACTION_BUTTON_CLASS,
  TREE_ROW_CLASS,
  TREE_ROW_CONTENT_START,
  TREE_ROW_CONTROL_IDLE_CLASS,
  TREE_ROW_CONTROL_SELECTED_CLASS,
  TREE_ROW_IDLE_CLASS,
  TREE_ROW_PARTIAL_SELECTION_CLASS,
  TREE_ROW_SELECTED_CLASS,
} from './itemsTreeStyles';
import { TREE_GUIDE_STEP } from '@/utils/treeGuides';

export interface LayerRowShellProps {
  layerName: string;
  rowKey: string;
  depth: number;
  isSelected: boolean;
  selectedChildCount: number;
  isBeingDragged: boolean;
  isDropInsideTarget: boolean;
  isVisible: boolean;
  isExpanded: boolean;
  hasChildren: boolean;
  itemCount: number;
  extraOpacityClass?: string;
  labelExtra?: React.ReactNode;
  menuSectionsBefore?: (close: () => void) => React.ReactNode;
  layerMenuExtra?: (close: () => void) => React.ReactNode;
  menuWidthClass?: string;
  visibilityLabel?: string;
  rowControlDataAttr?: Record<string, string>;
  layerParentOptions: LayerOption[];
  parentLayerId: string | null;
  onToggleExpand: () => void;
  onSelectLayer: (extendSelection: boolean) => void;
  onToggleVisibility: () => void;
  onCreateChildLayer: () => void;
  onMove: (targetLayerId: string | null) => void;
  onDelete: () => void;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPrimaryClick: (event: React.MouseEvent<HTMLElement>) => void;
  rowRef: (element: HTMLDivElement | null) => void;
  children?: React.ReactNode;
}

export const LayerRowShell: React.FC<LayerRowShellProps> = ({
  layerName,
  rowKey: _rowKey,
  depth,
  isSelected,
  selectedChildCount,
  isBeingDragged,
  isDropInsideTarget,
  isVisible,
  isExpanded,
  hasChildren,
  itemCount,
  extraOpacityClass = '',
  labelExtra,
  menuSectionsBefore,
  layerMenuExtra,
  menuWidthClass,
  visibilityLabel,
  rowControlDataAttr = {},
  layerParentOptions,
  parentLayerId,
  onToggleExpand,
  onSelectLayer,
  onToggleVisibility,
  onCreateChildLayer,
  onMove,
  onDelete,
  onPointerDown,
  onPrimaryClick,
  rowRef,
  children,
}) => {
  const rowControlClass = isSelected
    ? TREE_ROW_CONTROL_SELECTED_CLASS
    : TREE_ROW_CONTROL_IDLE_CLASS;

  const leadingTitle = hasChildren
    ? isExpanded
      ? 'Collapse layer'
      : 'Expand layer'
    : `Select ${layerName}`;
  const resolvedVisibilityLabel = visibilityLabel ?? (isVisible ? 'Hide layer' : 'Show layer');

  return (
    <div className="space-y-0.5">
      <div
        ref={rowRef}
        onPointerDown={onPointerDown}
        data-tree-row
        className={`${TREE_ROW_CLASS} ${
          isSelected
            ? TREE_ROW_SELECTED_CLASS
            : selectedChildCount > 0
              ? TREE_ROW_PARTIAL_SELECTION_CLASS
              : TREE_ROW_IDLE_CLASS
        } ${isVisible ? '' : 'opacity-50'} ${extraOpacityClass} ${
          isDropInsideTarget
            ? 'bg-primary-900/25 text-primary-100 ring-1 ring-inset ring-primary-500/45'
            : ''
        } ${isBeingDragged ? 'opacity-25' : ''}`}
        style={{
          paddingLeft: `${TREE_ROW_CONTENT_START + depth * TREE_GUIDE_STEP}px`,
        }}
      >
        <button
          type="button"
          onClick={() => (hasChildren ? onToggleExpand() : onSelectLayer(false))}
          {...rowControlDataAttr}
          className={`relative ${TREE_LEADING_BUTTON_CLASS} ${rowControlClass}`}
          title={leadingTitle}
          aria-label={leadingTitle}
        >
          <Icons.FolderOpen className="h-3.5 w-3.5 flex-shrink-0" />
          {hasChildren ? (
            <span
              className={`absolute -bottom-0.5 -left-0.5 rounded-sm ring-1 ${
                isSelected
                  ? 'bg-primary-950/90 text-primary-200 ring-primary-500/30'
                  : 'bg-gray-950/90 text-gray-300 ring-black/40'
              }`}
            >
              <Icons.ChevronDown
                className={`h-2.5 w-2.5 transition-transform ${
                  isExpanded ? 'rotate-0' : '-rotate-90'
                }`}
              />
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={onPrimaryClick}
          className={TREE_PRIMARY_BUTTON_CLASS}
          title={`Select ${layerName}`}
        >
          <span className="truncate font-medium tracking-[0.01em]">{layerName}</span>
          {labelExtra}
          <span
            className={`${TREE_COUNT_BADGE_CLASS} ${
              isSelected ? TREE_COUNT_BADGE_SELECTED_CLASS : TREE_COUNT_BADGE_IDLE_CLASS
            }`}
          >
            {itemCount}
          </span>
        </button>
        <button
          type="button"
          onClick={onToggleVisibility}
          {...rowControlDataAttr}
          className={`${TREE_ROW_ACTION_BUTTON_CLASS} ${rowControlClass}`}
          title={resolvedVisibilityLabel}
          aria-label={resolvedVisibilityLabel}
        >
          {isVisible ? (
            <Icons.Eye className="h-3.5 w-3.5" />
          ) : (
            <Icons.EyeSlash className="h-3.5 w-3.5" />
          )}
        </button>
        <FloatingMenu
          widthClass={menuWidthClass}
          trigger={
            <button
              type="button"
              {...rowControlDataAttr}
              className={`relative z-20 ${ROW_MENU_TRIGGER_CLASS} ${rowControlClass}`}
              title="Layer actions"
            >
              <Icons.EllipsisVertical className="h-3.5 w-3.5" />
            </button>
          }
        >
          {(close) => (
            <div className="space-y-2">
              {menuSectionsBefore?.(close)}
              {menuSectionsBefore ? <div className="h-px bg-white/10" /> : null}
              <div className="space-y-1">
                <MenuSectionLabel>Layer</MenuSectionLabel>
                <MenuButton
                  icon={<LayerPlusIcon />}
                  label="New Child Layer"
                  onClick={() => {
                    onCreateChildLayer();
                    close();
                  }}
                />
                {layerMenuExtra?.(close)}
              </div>
              <div className="h-px bg-white/10" />
              <MoveMenuSection
                label="Move to"
                options={layerParentOptions}
                currentValue={parentLayerId}
                onMove={(targetLayerId) => {
                  onMove(targetLayerId);
                  close();
                }}
                close={close}
              />
              <div className="h-px bg-white/10" />
              <MenuButton
                icon={<Icons.Trash className="h-4 w-4" />}
                label="Delete"
                danger
                onClick={() => {
                  onDelete();
                  close();
                }}
              />
            </div>
          )}
        </FloatingMenu>
      </div>

      {children}
    </div>
  );
};

export interface LeafItemRowShellProps {
  itemName: string;
  rowKey: string;
  depth: number;
  isSelected: boolean;
  isBeingDragged: boolean;
  isVisible: boolean;
  extraOpacityClass?: string;
  leadingIcon: React.ReactNode;
  labelExtra?: React.ReactNode;
  menuSectionsBefore?: (close: () => void) => React.ReactNode;
  menuSectionsAfterMove?: (close: () => void) => React.ReactNode;
  menuWidthClass?: string;
  visibilityLabel?: string;
  rowControlDataAttr?: Record<string, string>;
  layerOptions: LayerOption[];
  currentParentLayerId: string | null;
  onSelect: (extendSelection: boolean) => void;
  onToggleVisibility: () => void;
  onMove: (targetLayerId: string | null) => void;
  onDelete: () => void;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPrimaryClick: (event: React.MouseEvent<HTMLElement>) => void;
  rowRef: (element: HTMLDivElement | null) => void;
}

export const LeafItemRowShell: React.FC<LeafItemRowShellProps> = ({
  itemName,
  rowKey: _rowKey,
  depth,
  isSelected,
  isBeingDragged,
  isVisible,
  extraOpacityClass = '',
  leadingIcon,
  labelExtra,
  menuSectionsBefore,
  menuSectionsAfterMove,
  menuWidthClass,
  visibilityLabel,
  rowControlDataAttr = {},
  layerOptions,
  currentParentLayerId,
  onSelect: _onSelect,
  onToggleVisibility,
  onMove,
  onDelete,
  onPointerDown,
  onPrimaryClick,
  rowRef,
}) => {
  const rowControlClass = isSelected
    ? TREE_ROW_CONTROL_SELECTED_CLASS
    : TREE_ROW_CONTROL_IDLE_CLASS;
  const resolvedVisibilityLabel =
    visibilityLabel ?? (isVisible ? `Hide ${itemName}` : `Show ${itemName}`);

  return (
    <div
      ref={rowRef}
      onPointerDown={onPointerDown}
      data-tree-row
      className={`${TREE_ROW_CLASS} ${
        isSelected ? TREE_ROW_SELECTED_CLASS : TREE_ROW_IDLE_CLASS
      } ${isVisible ? '' : 'opacity-50'} ${extraOpacityClass} ${
        isBeingDragged ? 'opacity-25' : ''
      }`}
      style={{ paddingLeft: `${TREE_ROW_CONTENT_START + depth * TREE_GUIDE_STEP}px` }}
    >
      <button
        type="button"
        onClick={onPrimaryClick}
        className={`${TREE_LEADING_BUTTON_CLASS} ${rowControlClass} cursor-grab active:cursor-grabbing`}
        title={`Select ${itemName}`}
        aria-label={`Select ${itemName}`}
      >
        {leadingIcon}
      </button>
      <button
        type="button"
        onClick={onPrimaryClick}
        className={TREE_PRIMARY_BUTTON_CLASS}
        title={`Select ${itemName}`}
      >
        <span className="truncate font-medium tracking-[0.01em]">{itemName}</span>
        {labelExtra}
      </button>
      <button
        type="button"
        onClick={onToggleVisibility}
        {...rowControlDataAttr}
        className={`${TREE_ROW_ACTION_BUTTON_CLASS} ${rowControlClass}`}
        title={resolvedVisibilityLabel}
        aria-label={resolvedVisibilityLabel}
      >
        {isVisible ? (
          <Icons.Eye className="h-3.5 w-3.5" />
        ) : (
          <Icons.EyeSlash className="h-3.5 w-3.5" />
        )}
      </button>
      <FloatingMenu
        widthClass={menuWidthClass}
        trigger={
          <button
            type="button"
            {...rowControlDataAttr}
            className={`relative z-20 ${ROW_MENU_TRIGGER_CLASS} ${rowControlClass}`}
            title={`${itemName} actions`}
          >
            <Icons.EllipsisVertical className="h-3.5 w-3.5" />
          </button>
        }
      >
        {(close) => (
          <div className="space-y-2">
            {menuSectionsBefore?.(close)}
            {menuSectionsBefore ? <div className="h-px bg-white/10" /> : null}
            <MoveMenuSection
              label="Move to"
              options={layerOptions}
              currentValue={currentParentLayerId}
              onMove={(targetLayerId) => {
                onMove(targetLayerId);
                close();
              }}
              close={close}
            />
            {menuSectionsAfterMove ? (
              <>
                <div className="h-px bg-white/10" />
                {menuSectionsAfterMove(close)}
              </>
            ) : null}
            <div className="h-px bg-white/10" />
            <MenuButton
              icon={<Icons.Trash className="h-4 w-4" />}
              label="Delete"
              danger
              onClick={() => {
                onDelete();
                close();
              }}
            />
          </div>
        )}
      </FloatingMenu>
    </div>
  );
};
